//! The presentation window (F10).
//!
//! It loads the app's own frontend on the `#/present` route rather than a raw
//! slide document, so navigation, timers and speaker features stay in one place.
//!
//! The window is built once and then reused: ending a presentation hides it
//! instead of closing it. Destroying a webview whose web process still has
//! layer-tree commits in flight segfaults the whole application inside WebKit
//! (`RemoteLayerTreeDrawingAreaProxyMac::displayLink`), and a fullscreen window
//! showing a deck that animates produces exactly that traffic. Nothing is ever
//! torn down, so the race has nowhere to happen.
//!
//! Because the window is hidden and shown again rather than created and
//! destroyed, it uses *simple* fullscreen (pre-Lion style: screen-sized frame,
//! no titlebar, dock and menu bar auto-hidden) instead of the native kind.
//! Native fullscreen puts the window in its own macOS space and leaves it
//! there through an animated transition that `set_fullscreen(false)` only
//! starts; hiding the window in the middle of that transition loses the race —
//! AppKit finishes the exit by ordering the window back in, and the user is
//! left with an empty window that the presentation has already been torn out
//! of. Simple fullscreen is applied and dropped synchronously, so hiding right
//! after it is over is deterministic.
//!
//! What simple fullscreen costs is the keyboard, and it has to be bought back
//! by hand — see [`focus_presentation_webview`].
//!
//! # Every command here is `async`, and has to stay that way
//!
//! Off macOS, `set_simple_fullscreen` falls back to the native kind and none of
//! the above applies. What applies instead is the opposite hazard: on Windows a
//! command's arguments arrive on WebView2's own `WebMessageReceived` handler,
//! which runs on the event-loop thread — and `send_user_message` executes
//! anything dispatched *from* that thread inline rather than queueing it. A
//! synchronous command therefore ends up calling WebView2's COM interface from
//! inside WebView2's own event handler, which re-enters the control and hangs
//! the window: the deck freezes on its first frame and neither the keyboard nor
//! the mouse comes back. It is the same trap Tauri documents on
//! `WebviewWindowBuilder::build` ("deadlocks when used in a synchronous command
//! and event handlers"), and it applies to every window and webview call, not
//! just window creation. Marking the command `async` moves it off that thread,
//! so the work is queued for the event loop instead of run inside the handler.

use tauri::{
    AppHandle, Emitter, EventTarget, Manager, Runtime, Webview, WebviewUrl, WebviewWindowBuilder,
};

use crate::error::AppResult;

pub const PRESENTATION_LABEL: &str = "presentation";

/// The editor window, used to pick the screen the deck is projected on.
const MAIN_LABEL: &str = "main";

/// Tells a window that is already built which slide to resume from.
const START_EVENT: &str = "present:start";

#[tauri::command]
pub async fn open_presentation_window(app: AppHandle, start_index: usize) -> AppResult<()> {
    if let Some(existing) = app.get_webview_window(PRESENTATION_LABEL) {
        // Order matters on macOS: the window has to be on screen before it can
        // be sized to the screen it is on, and the deck is better off loading
        // behind the transition than after it.
        existing.show()?;
        existing.set_simple_fullscreen(true)?;
        existing.set_focus()?;
        // Last, so that the window is already fullscreen and key by the time
        // the deck starts loading — and, more importantly, so that the
        // presentation's own `focus_presentation_webview` call lands *after*
        // the style-mask switch that would otherwise undo it.
        app.emit_to(
            EventTarget::AnyLabel {
                label: PRESENTATION_LABEL.into(),
            },
            START_EVENT,
            start_index,
        )?;
        return Ok(());
    }

    let url = WebviewUrl::App(format!("index.html#/present?start={start_index}").into());
    let mut builder = WebviewWindowBuilder::new(&app, PRESENTATION_LABEL, url).title("Presentation");
    // Open it on the screen the author is working on, already the size of that
    // screen: going fullscreen then only has the titlebar left to remove, so
    // there is no half-sized window flashing up first.
    if let Some(monitor) = editor_monitor(&app) {
        let scale = monitor.scale_factor();
        let position = monitor.position().to_logical::<f64>(scale);
        let size = monitor.size().to_logical::<f64>(scale);
        builder = builder
            .position(position.x, position.y)
            .inner_size(size.width, size.height);
    }
    let window = builder.build()?;
    window.set_simple_fullscreen(true)?;
    window.set_focus()?;

    Ok(())
}

/// Gives the keyboard back to the presentation's web content. **macOS only.**
///
/// Simple fullscreen works by clearing `NSWindowStyleMask::Titled`, and changing
/// a window's style mask drops its first responder — so tao restores one itself,
/// and the one it picks is *its own* content view (`util::toggle_style_mask`,
/// whose comment is "if we don't do this, key handling will break"). The
/// WKWebView is a subview of that view, and key events travel up the responder
/// chain rather than down into subviews, so after the switch the presentation
/// window's `window` object never sees another `keydown`: the arrow keys and
/// Escape stop working and macOS beeps at every press.
///
/// The window-level `set_focus` does not cover this. `WebviewWindow` forwards it
/// to the *window* (`makeKeyAndOrderFront:`), which decides which window is key,
/// not which view inside it holds the keyboard. Only the webview's own focus
/// reaches `makeFirstResponder:`.
///
/// It is the presentation that asks, rather than something done to it from here,
/// because the caller is then the one view we want focused: reading the webview
/// off the invoke gives it to us on stable Tauri, while `Manager::get_webview`
/// is behind the `unstable` feature. The label check keeps it to that window —
/// the editor has no business pulling the first responder onto a hidden webview.
///
/// Everywhere else this is deliberately a no-op. There is no style mask to
/// clear off macOS, so nothing takes the keyboard away in the first place, and
/// on Windows the call it would make is the one that hangs the presentation
/// (see the module comment). The presentation keeps calling it unconditionally
/// so the reason lives here rather than being spelled out again in the frontend.
#[tauri::command]
pub async fn focus_presentation_webview<R: Runtime>(webview: Webview<R>) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        if webview.label() == PRESENTATION_LABEL {
            webview.set_focus()?;
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = webview;
    }
    Ok(())
}

/// Ends the presentation. The window is hidden rather than closed — see the
/// module comment for why closing it takes the whole app down with it.
#[tauri::command]
pub async fn close_presentation_window(app: AppHandle) -> AppResult<()> {
    if let Some(window) = app.get_webview_window(PRESENTATION_LABEL) {
        // Leave fullscreen before disappearing. It is not cosmetic: simple
        // fullscreen hides the dock and the menu bar for the *application*, so
        // a window that hides while still fullscreen leaves the editor behind
        // with both of them gone.
        window.set_simple_fullscreen(false)?;
        window.hide()?;
    }
    Ok(())
}

/// The monitor the editor window is on, when there is one to ask.
fn editor_monitor(app: &AppHandle) -> Option<tauri::Monitor> {
    let main = app.get_webview_window(MAIN_LABEL)?;
    main.current_monitor()
        .ok()
        .flatten()
        .or_else(|| main.primary_monitor().ok().flatten())
}
