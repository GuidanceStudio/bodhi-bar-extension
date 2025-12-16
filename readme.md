# 🚀 Ungroup New Tabs

## Description

**Ungroup New Tabs** is a small but powerful background extension for Brave and Chromium that solves an annoying default behavior: tab group inheritance.

When you open a new link (e.g., via `Ctrl + Click` or right-click > "Open in new tab") from a tab that is part of a group, the browser automatically places the new tab into the same group. This extension intervenes immediately to automate the process of separation and repositioning.

## Features

* **Automatic Ungrouping:** Instantly removes any new tab created from a link from the tab group it is placed into by default.
* **End Repositioning:** Moves the newly ungrouped tab to the **very end** of the current window's tab bar, keeping your workspace organized.
* **Background Operation:** Operates silently and automatically, requiring no user interaction or keyboard shortcuts.

## Installation (Developer Mode)

This extension is not available on the Chrome Web Store and must be manually loaded in Developer Mode.

### Prerequisites

* **Extension Files:** Ensure you have the following files saved in a single folder (e.g., `UngroupAutomatic`):
    * `manifest.json` (Updated with author and icon)
    * `background.js` (Updated with ungroup and move-to-end logic)
    * `icon128.png` (Your 128x128 icon file)

### Loading Steps

1.  **Open Extensions Page:** In Brave (or Chrome), type `brave://extensions` (or `chrome://extensions`) in the address bar.
2.  **Enable Developer Mode:** Turn on the **"Developer mode"** toggle switch in the top right corner.
3.  **Load Extension:** Click on the **"Load unpacked"** button.
4.  **Select Folder:** Select the main folder (`UngroupAutomatic`) that contains the three files.

The extension will now appear in the list and is immediately active.

## Technical Details

| Field | Value | Description |
| :--- | :--- | :--- |
| **Name** | `Ungroup New Tabs` | The name of the extension. |
| **Version** | `1.3` | Current version. |
| **Author** | `guidance.studio` | The author of the project. |
| **Required Permissions** | `tabs`, `tabGroups` | Essential for reading and manipulating the status and group membership of tabs. |
| **Logic** | `background.js` | Contains a listener for `chrome.tabs.onCreated` with a short timeout to perform ungrouping and repositioning. |