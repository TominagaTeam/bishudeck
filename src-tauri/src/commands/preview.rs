//! Publishing slide documents to the `slides://` origin.

use tauri::State;

use crate::protocol;
use crate::state::AppState;

/// Hands a fully composed HTML document to the backend and returns the URL the
/// preview iframe should load. Composition happens in the frontend so that no
/// HTML parsing logic is duplicated in Rust.
#[tauri::command]
pub fn publish_preview(state: State<'_, AppState>, id: String, html: String) -> String {
    state.publish_preview(id.clone(), html);
    protocol::slide_url(&id)
}

#[tauri::command]
pub fn clear_previews(state: State<'_, AppState>) {
    state.clear_previews();
}

/// Lets the frontend rewrite `assets/...` references to absolute URLs.
#[tauri::command]
pub fn preview_base_url() -> String {
    protocol::base_url()
}
