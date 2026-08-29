//! The `slides://` URI scheme.
//!
//! Everything served here is *user content*. Because it is delivered on its own
//! origin, the preview iframe can be sandboxed with `allow-scripts` alone: the
//! slide's JavaScript runs exactly as authored but has no path back to the app
//! window or the Tauri IPC bridge.

use tauri::http::{Request, Response};
use tauri::{AppHandle, Manager, Runtime};

use crate::fonts;
use crate::state::AppState;

pub const SCHEME: &str = "slides";

/// The origin the webview will actually see, which differs by platform.
pub fn base_url() -> String {
    if cfg!(windows) {
        format!("http://{SCHEME}.localhost")
    } else {
        format!("{SCHEME}://localhost")
    }
}

pub fn slide_url(id: &str) -> String {
    format!("{}/s/{}", base_url(), id)
}

pub fn handle<R: Runtime>(app: &AppHandle<R>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    route(&app.state::<AppState>(), request.uri().path())
}

pub fn route(state: &AppState, path: &str) -> Response<Vec<u8>> {
    let segments: Vec<&str> = path.trim_start_matches('/').split('/').collect();

    match segments.as_slice() {
        ["s", id] => match state.preview(id) {
            Some(html) => html_response(html),
            None => not_found(format!("no published preview for slide {id}")),
        },
        // The app's own typefaces (fonts.rs). They are the one thing served
        // here that is *not* user content — every consumer of a bundled font
        // asks for it under this origin, including the app window itself, so
        // that the opaque-origin preview frame can reach it at all.
        ["fonts", name] => match fonts::bundled(name) {
            Some(bytes) => font_response(name, bytes.to_vec()),
            None => not_found(format!("no such bundled font: {name}")),
        },
        ["assets", name] => match state.asset(name) {
            Some(bytes) => {
                let mime = mime_guess::from_path(name).first_or_octet_stream();
                base_headers(Response::builder())
                    .header("Content-Type", mime.essence_str())
                    .body(bytes)
                    .unwrap()
            }
            None => not_found(format!("no such asset: {name}")),
        },
        _ => not_found(format!("unroutable path: {path}")),
    }
}

fn html_response(html: String) -> Response<Vec<u8>> {
    base_headers(Response::builder())
        .header("Content-Type", "text/html; charset=utf-8")
        .body(html.into_bytes())
        .unwrap()
}

/// The one response here that *is* worth caching.
///
/// Everything else on this scheme is republished as the user edits, but a
/// bundled face cannot change without a new build of the app. Without this the
/// stylesheet — 100KB of `unicode-range` — would be re-fetched and re-parsed
/// every time a slide is republished, which is every keystroke.
///
/// The flip side: replacing a file in `src-tauri/fonts/` during development can
/// leave the webview holding the old one (src-tauri/fonts/README.md).
fn font_response(name: &str, bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .header("Access-Control-Allow-Origin", "*")
        .header("Content-Type", fonts::content_type(name))
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .body(bytes)
        .unwrap()
}

fn not_found(message: String) -> Response<Vec<u8>> {
    base_headers(Response::builder())
        .status(404)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(message.into_bytes())
        .unwrap()
}

/// Previews are republished on every change, so caching them would only ever
/// show the user a stale slide.
fn base_headers(builder: tauri::http::response::Builder) -> tauri::http::response::Builder {
    builder
        .header("Cache-Control", "no-store")
        .header("Access-Control-Allow-Origin", "*")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body_of(response: &Response<Vec<u8>>) -> String {
        String::from_utf8_lossy(response.body()).into_owned()
    }

    #[test]
    fn serves_a_published_slide() {
        let state = AppState::default();
        state.publish_preview("slide-1".into(), "<h1>hello</h1>".into());

        let response = route(&state, "/s/slide-1");
        assert_eq!(response.status(), 200);
        assert_eq!(body_of(&response), "<h1>hello</h1>");
        assert_eq!(
            response.headers().get("Content-Type").unwrap(),
            "text/html; charset=utf-8"
        );
    }

    #[test]
    fn never_caches_previews() {
        let state = AppState::default();
        state.publish_preview("s".into(), "<p>a</p>".into());
        let response = route(&state, "/s/s");
        assert_eq!(response.headers().get("Cache-Control").unwrap(), "no-store");
    }

    #[test]
    fn serves_assets_with_a_guessed_type() {
        let state = AppState::default();
        state.put_asset("asset_001.png".into(), vec![0x89, 0x50, 0x4e, 0x47]);

        let response = route(&state, "/assets/asset_001.png");
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers().get("Content-Type").unwrap(), "image/png");
        assert_eq!(response.body(), &vec![0x89, 0x50, 0x4e, 0x47]);
    }

    #[test]
    fn unknown_paths_are_not_found() {
        let state = AppState::default();
        assert_eq!(route(&state, "/s/missing").status(), 404);
        assert_eq!(route(&state, "/assets/missing.png").status(), 404);
        assert_eq!(route(&state, "/fonts/missing.woff2").status(), 404);
        assert_eq!(route(&state, "/../../etc/passwd").status(), 404);
    }

    #[test]
    fn serves_the_bundled_font_stylesheet() {
        let state = AppState::default();
        let response = route(&state, "/fonts/fonts.css");

        assert_eq!(response.status(), 200);
        assert_eq!(
            response.headers().get("Content-Type").unwrap(),
            "text/css; charset=utf-8"
        );
        assert!(String::from_utf8_lossy(response.body()).contains("'Noto Sans'"));
    }

    /// The preview frame has no origin of its own to match against, so a font
    /// it fetches is only allowed through by a wildcard.
    #[test]
    fn bundled_fonts_are_readable_from_the_sandboxed_preview() {
        let state = AppState::default();
        let response = route(&state, "/fonts/noto-sans-latin-wght-normal.woff2");

        assert_eq!(response.status(), 200);
        assert_eq!(response.headers().get("Content-Type").unwrap(), "font/woff2");
        assert_eq!(
            response.headers().get("Access-Control-Allow-Origin").unwrap(),
            "*"
        );
    }

    /// Unlike everything else on this scheme: a face cannot change without a
    /// new build, and the stylesheet is re-requested on every republish.
    #[test]
    fn bundled_fonts_are_cached() {
        let state = AppState::default();
        let cache = route(&state, "/fonts/fonts.css");
        let cache = cache.headers().get("Cache-Control").unwrap();
        assert!(cache.to_str().unwrap().contains("immutable"));
    }

    #[test]
    fn old_previews_are_evicted_so_the_map_stays_bounded() {
        let state = AppState::default();
        for i in 0..40 {
            state.publish_preview(format!("s{i}"), format!("<p>{i}</p>"));
        }
        assert_eq!(route(&state, "/s/s0").status(), 404);
        assert_eq!(route(&state, "/s/s39").status(), 200);
    }
}
