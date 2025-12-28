// site_overrides.js
/*
 NOTE: For any edits that touch content scripts or the background/service worker,
 please also add these files to the chat so I can make coordinated, minimal changes:
   - background.js
   - constants.js
   - messaging.js
   - content.js
   - render.js
   - popup.js / popup.html
   - manifest.json
   - dom-helpers.js
   - page-shift.js
   - zoom.js
*/

 // site_overrides.js
 // Per-site exceptions only. Injected by background.js into all frames.

 (() => {
   const api = {
     headerShiftMode(el) {
       try {
         const host = location.hostname || '';
         if ((host === 'www.youtube.com' || host.endsWith('.youtube.com')) && el?.id === 'masthead-container') {
           return { mode: 'transform' };
         }
       } catch {}
       return null;
     },

     getSafeBottomContainer() {
       try {
         const host = location.hostname || '';
         if (host === 'docs.google.com' && location.pathname.includes('/spreadsheets/')) {
           return document.getElementById('0-grid-container') || null;
         }
       } catch {}
       return null;
     }
   };

   window.__TZ_SITE_OVERRIDES__ = api;
   window.TZ_SITE_OVERRIDES = api;
   window.TZ_SITE_OVERRIDES_LOADED = true;
 })();
