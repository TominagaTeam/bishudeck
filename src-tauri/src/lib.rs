mod commands;
mod error;
mod fonts;
mod protocol;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .register_uri_scheme_protocol(protocol::SCHEME, |ctx, request| {
            protocol::handle(ctx.app_handle(), request)
        })
        .invoke_handler(tauri::generate_handler![
            commands::preview::publish_preview,
            commands::preview::clear_previews,
            commands::preview::preview_base_url,
            commands::project::read_text_file,
            commands::project::export_html,
            commands::project::set_live_project,
            commands::project::get_live_project,
            commands::assets::import_asset,
            commands::assets::put_asset_bytes,
            commands::assets::list_assets,
            commands::window::open_presentation_window,
            commands::window::close_presentation_window,
            commands::window::focus_presentation_webview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
