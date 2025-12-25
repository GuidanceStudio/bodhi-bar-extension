# 🚀 Bodhi Bar - Smart Tab Manager

Chrome extension that improves tab management by automatically removing new tabs from groups and providing a horizontal UI.

## 🌟 Key Features
- **Auto Ungrouping**: New tabs are automatically removed from existing groups
- **Horizontal Tab Bar**: Clean dark interface showing ungrouped tabs with quick access
- **Integrated Search**: Find tabs instantly with highlighting
- **Group Navigation**: Multi-level browsing through tab groups
- **Quick Actions**: One-click tab closing, moving and opening
- **Responsive Design**: Adapts seamlessly to zoom and window resizing
- **Smooth Dragging**: Visual feedback during tab reorganization

## ⚠️ Important
Works exclusively on normal websites (`https://...`), not on browser system pages like `chrome://extensions`.

## 📂 Project Structure
Our codebase is organized into 12 specialized components:
- **Background Service**: Main extension logic
- **Constants**: Shared configuration values
- **UI Styles**: Visual presentation rules
- **UI Entry Point**: Initialization and core logic
- **DOM Utilities**: Element creation helpers
- **Drag & Drop**: Tab reorganization handlers
- **Extension Config**: Manifest definition
- **Component Communication**: Messaging system
- **Page Adaptation**: Header collision prevention
- **Context Panels**: Group/search interfaces
- **Rendering**: UI construction functions
- **Tab Search**: Filtering and highlighting
- **Site Rules**: Special case handling
- **Zoom Handling**: Display scaling management

## ⚙️ Development Installation
1. Enable Developer Mode in Chrome extensions
2. Click "Load Unpacked Extension"
3. Select our source folder
4. Refresh normal websites to activate

## 🛠 Troubleshooting
**Service Worker "Inactive"**
- Verify no import errors exist
- Ensure background script uses proper module pattern
- Confirm manifest configuration

**Empty Bar with "No Receiver" Message**
- Check browser console for errors
- Reload the extension
- Validate all files are present

## 🛠 Technical Highlights
- Modular architecture with 12 independent components
- Full Manifest V3 compatibility
- Robust error handling throughout
- Ready for deployment to Chrome Web Store
- Maintained with continuous integration best practices

> Project lovingly maintained with modern development tools
