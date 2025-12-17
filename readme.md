# 🚀 Guidance Tab Manager

## Description

**Guidance Tab Manager** is a background extension for Brave and Chromium that serves two primary functions:
1.  **Tab Management:** It automatically removes any new tab created from a link out of its parent's tab group and moves it to the end of the web tab list, maintaining system tabs at the far end.
2.  **UI Enhancement:** It injects a horizontal, dark-mode-styled "fake tab bar" into every webpage, displaying all currently open, non-grouped tabs for quick switching, optimized for users utilizing vertical tab grouping.

## Features

* **Automatic Ungrouping:** Removes new tabs from their inherited tab group.
* **Smart Tab Ordering:** New web tabs are placed immediately before the first system/browser tab (`chrome://`, `about:`).
* **Consistent UI:** The leftmost navigation button (Group Trigger or Back Button) maintains a constant, fixed width across all views for interface stability.
* **Dark Mode UI:** Displays an overlay bar at the top of every page, styled with dark colors for aesthetic consistency.
* **Quick Switching:** Lists all open, non-grouped tabs for rapid navigation via clicking.

## 🛑 Important Limitation: Browser Pages

Due to inherent security restrictions in Chromium-based browsers (Brave/Chrome), this extension **cannot** inject the UI bar into internal browser pages, such as:
* `brave://settings`
* `brave://extensions`
* `chrome://flags`
* The UI bar will only appear on standard web pages (e.g., `https://google.com`).

## Recommended Feature: Vertical Tabs

For an optimal experience (as this extension effectively gives you a horizontal tab bar *back*), the author strongly recommends enabling vertical tab grouping in your browser. **Note: Extensions cannot automatically set browser flags, so this must be done manually.**

1.  Open the Flags page: Type `brave://flags` (or `chrome://flags`) in your address bar.
2.  Search for: `#enable-vertical-tabs` (or similar terms related to vertical tab view).
3.  Set the relevant flag to **Enabled**.
4.  Restart your browser.

## Installation (Developer Mode)

### Prerequisites

* Ensure you have the latest versions of `manifest.json`, `background.js`, `content.js`, and `icon128.png` saved in a single folder.

### Loading Steps

1.  **Open Extensions Page:** In Brave (or Chrome), type `brave://extensions` (or `chrome://extensions`) in the address bar.
2.  **Enable Developer Mode:** Turn on the **"Developer mode"** toggle switch.
3.  **Load Extension:** Click on **"Load unpacked"**.
4.  **Select Folder:** Select the main extension folder.

## Technical Details

| Field | Value | Description |
| :--- | :--- | :--- |
| **Name** | `Guidance Tab Manager` | The new name of the extension. |
| **Version** | `1.7` | Updated version. |
| **Permissions** | `tabs`, `tabGroups`, `scripting` | Core permissions for tab manipulation and UI injection. |