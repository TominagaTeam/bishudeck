//! Backend-held state: published preview documents and project assets.
//!
//! Slide HTML is pushed here by the frontend right before it is displayed, then
//! served back over the `slides://` scheme so the preview iframe lands on a
//! *different origin* than the app itself (docs/adr/0002-edit-preview-separation.md).

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Default)]
pub struct AppState {
    inner: RwLock<Inner>,
}

/// Each edit republishes under a fresh id, so without a bound the map would
/// grow for the whole session. Only the most recent few can still be loading.
const MAX_LIVE_PREVIEWS: usize = 8;

#[derive(Default)]
struct Inner {
    /// slide id -> complete HTML document ready to be served.
    previews: HashMap<String, String>,
    /// Publication order, oldest first, used to evict.
    preview_order: Vec<String>,
    /// asset name -> raw bytes.
    assets: HashMap<String, Vec<u8>>,
    /// The project as it currently stands in the editor. Each window runs its
    /// own JavaScript context, so this is how the presentation window gets the
    /// deck without the editor having to stream it over events.
    live_project: Option<serde_json::Value>,
}

impl AppState {
    pub fn publish_preview(&self, id: String, html: String) {
        let mut guard = self.inner.write().unwrap();
        if guard.previews.insert(id.clone(), html).is_none() {
            guard.preview_order.push(id);
        }
        while guard.preview_order.len() > MAX_LIVE_PREVIEWS {
            let oldest = guard.preview_order.remove(0);
            guard.previews.remove(&oldest);
        }
    }

    pub fn preview(&self, id: &str) -> Option<String> {
        self.inner.read().unwrap().previews.get(id).cloned()
    }

    pub fn clear_previews(&self) {
        let mut guard = self.inner.write().unwrap();
        guard.previews.clear();
        guard.preview_order.clear();
    }

    pub fn put_asset(&self, name: String, bytes: Vec<u8>) {
        self.inner.write().unwrap().assets.insert(name, bytes);
    }

    pub fn asset(&self, name: &str) -> Option<Vec<u8>> {
        self.inner.read().unwrap().assets.get(name).cloned()
    }

    pub fn asset_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.inner.read().unwrap().assets.keys().cloned().collect();
        names.sort();
        names
    }

    pub fn all_assets(&self) -> Vec<(String, Vec<u8>)> {
        let guard = self.inner.read().unwrap();
        let mut items: Vec<(String, Vec<u8>)> = guard
            .assets
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        items.sort_by(|a, b| a.0.cmp(&b.0));
        items
    }


    /// Picks an unused `asset_NNN.<ext>` name so URLs stay ASCII-safe and no
    /// percent-decoding is needed when serving them.
    pub fn next_asset_name(&self, ext: &str) -> String {
        let guard = self.inner.read().unwrap();
        let mut n = guard.assets.len() + 1;
        loop {
            let candidate = if ext.is_empty() {
                format!("asset_{n:03}")
            } else {
                format!("asset_{n:03}.{ext}")
            };
            if !guard.assets.contains_key(&candidate) {
                return candidate;
            }
            n += 1;
        }
    }

    pub fn set_live_project(&self, project: serde_json::Value) {
        self.inner.write().unwrap().live_project = Some(project);
    }

    pub fn live_project(&self) -> Option<serde_json::Value> {
        self.inner.read().unwrap().live_project.clone()
    }
}
