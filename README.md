# Pure Bookmarks

Pure Bookmarks is a browser extension that replaces the new tab page with a clean bookmarks dashboard.

## What the app is

The app reads the user’s existing browser bookmarks and displays them in a simple, organized interface. It is meant to make bookmarks easier to browse, open, and manage from the new tab page.

## Main goals

- Show bookmarks from the browser in a clear layout
- Render each bookmark folder as its own card with its own links
- Show folder cards in a masonry layout similar to Pinterest
- Let each folder card use its own layout mode
- Let users browse bookmarks from a selected root folder
- Allow users to edit real bookmark data from the app
- Keep bookmark changes synced with the browser’s native bookmarks system
- Support bookmark actions such as open, copy, and delete
- Let users choose display preferences such as theme and layout
- Keep browser functions separated from UI so the app can support other browsers later

## Features to implement

### Core bookmark experience

- Load the full bookmarks tree from the browser
- Display bookmarks and folders in a usable new tab interface
- Render each folder as its own card component
- Show the links that belong to each folder inside its card
- Arrange folder cards in a masonry layout similar to Pinterest
- Support nested and flat folder views
- Refresh the UI after bookmark changes

### Folder root selection

- On first launch, ask the user to choose the folder the app should use as its root
- Use the browser root by default if the user does not choose another folder
- If the user selects another folder, treat that folder as the app root
- Load and display bookmarks relative to the selected root folder
- Save the selected root folder preference for future launches

### Card layouts

- Support a separate layout setting for each folder card
- Allow each card to switch between:
  - List
  - Icons Grid
- Save per-card layout preferences

### Bookmark editing

- Edit bookmark title
- Edit bookmark URL
- Edit folder title
- Save changes back to the browser bookmarks API

### Bookmark actions

- Open bookmarks
- Copy bookmark URL
- Copy bookmark title
- Delete bookmarks
- Delete folders
- Open a bookmark or folder in the browser’s bookmark manager when supported

### Interface and customization

- Theme support
- Configurable root folder
- Saved user layout preferences
- Masonry-style folder card presentation

### Cross-browser readiness

- Separate browser-specific functions from UI components
- Keep bookmark operations behind browser adapters
- Prepare the app to support Chrome-family browsers and Firefox later

## Development

```bash
bun dev
bun run build
```
