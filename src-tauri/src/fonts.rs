//! The typefaces shipped with the app.
//!
//! Everything else the picker offers is a face the machine happened to have,
//! probed for at runtime and hidden when absent (`src/shared/fonts.ts`). These
//! two — Noto Sans and Noto Sans JP — are the ones the editor can promise, and
//! the promise is what makes them usable as the default: a deck styled here
//! draws the same on the next machine because the face travels with the app
//! rather than with the operating system.
//!
//! They are served over `slides://` and not from the frontend's own origin for
//! one reason: the preview frame is sandboxed *without* `allow-same-origin`, so
//! it is an opaque origin, and Tauri answers frontend requests with
//! `Access-Control-Allow-Origin: <window origin>` — which an opaque origin
//! never matches. `slides://` already answers `*` (protocol.rs), so one URL
//! works for the app window, the edit frame and the preview frame alike.
//!
//! Rust does not read or interpret any of this; it hands over bytes under a
//! name, the same way it does an imported image.

use std::path::Path;

// `name -> bytes` for every file in `src-tauri/fonts/`, written by build.rs.
include!(concat!(env!("OUT_DIR"), "/bundled_fonts.rs"));

/// The bytes filed under `name`, or `None` if nothing is.
///
/// The lookup is an exact match against a fixed table, which is also what makes
/// the path safe: a request for `../../secrets` is not a traversal to defend
/// against here, it is simply a name no entry has.
pub fn bundled(name: &str) -> Option<&'static [u8]> {
    BUNDLED
        .iter()
        .find(|(entry, _)| *entry == name)
        .map(|(_, bytes)| *bytes)
}

/// The MIME type to serve `name` as.
///
/// Spelled out rather than guessed: `mime_guess` is right about both of these
/// today, but a font served as `application/octet-stream` fails silently — the
/// text just draws in the fallback face — and there are exactly two extensions
/// to know about.
pub fn content_type(name: &str) -> &'static str {
    match Path::new(name).extension().and_then(|ext| ext.to_str()) {
        Some("woff2") => "font/woff2",
        Some("css") => "text/css; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ships_the_stylesheet_that_declares_the_faces() {
        let css = bundled("fonts.css").expect("fonts.css must be bundled");
        let css = String::from_utf8_lossy(css);
        assert!(css.contains("font-family: 'Noto Sans';"));
        assert!(css.contains("font-family: 'Noto Sans JP';"));
    }

    /// Every `url(...)` in the stylesheet has to name something the table can
    /// hand back, or the face silently falls through to a system font.
    #[test]
    fn every_face_the_stylesheet_names_is_bundled() {
        let css = bundled("fonts.css").unwrap();
        let css = String::from_utf8_lossy(css);

        let mut checked = 0;
        for rest in css.split("url(").skip(1) {
            let name = rest.split(')').next().expect("unterminated url()");
            assert!(bundled(name).is_some(), "{name} is referenced but not bundled");
            checked += 1;
        }
        assert!(checked > 100, "expected the CJK subsets, found {checked} faces");
    }

    #[test]
    fn names_the_type_of_what_it_serves() {
        assert_eq!(content_type("noto-sans-latin-wght-normal.woff2"), "font/woff2");
        assert_eq!(content_type("fonts.css"), "text/css; charset=utf-8");
    }

    #[test]
    fn a_name_no_entry_has_is_simply_absent() {
        assert!(bundled("../../../etc/passwd").is_none());
        assert!(bundled("").is_none());
    }
}
