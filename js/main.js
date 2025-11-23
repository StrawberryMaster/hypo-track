// main initialization and coordination

const HypoTrack = (() => {
    
    function init() {
        // update database version if necessary
        if (Dexie.getDatabaseNames) {
            Dexie.getDatabaseNames().then(names => {
                if (names.includes(AppState.IDB_KEY)) {
                    const tempDb = new Dexie(AppState.IDB_KEY);
                    tempDb.version(1).stores({ saves: '' });
                    tempDb.open().then(() => {
                        tempDb.close();
                        const db = new Dexie(IDB_KEY);
                        db.version(4).stores({ saves: '', maps: '', categories: '&name', folders: '&name' });
                        db.version(3).stores({ saves: '', maps: '', categories: '&name' });
                        db.version(2).stores({ saves: '', maps: '' });
                    }).catch(() => {
                        console.log('Database already up to date.');
                    });
                }
            }).catch(err => console.error('Error checking database version:', err));
        }

        document.title = AppState.TITLE;
        
        // create and setup canvas
        const canvas = document.createElement('canvas');
        canvas.width = AppState.WIDTH;
        canvas.height = AppState.HEIGHT;
        
        const container = document.getElementById('canvas-container');
        if (!container) {
            console.error('Zoinks! Canvas container not found.');
            return;
        }

        container.style.position = 'relative';
        container.appendChild(canvas);
        canvas.style.touchAction = 'none';
        
        AppState.setCanvas(canvas);
        AppState.setCtx(canvas.getContext('2d'));

        // create UI overlays on canvas
        Renderer.createCoordinatesTab(container);
        Renderer.createZoomControls(container);

        // initialize pan location
        AppState.setPanLocation({ long: -180, lat: 90 });

        // load custom categories
        Database.loadCategories().then(loaded => {
            AppState.setCustomCategories(loaded);
            Utils.regenerateMasterCategories();
            // refresh UI after categories are loaded
            const refreshGUI = AppState.getRefreshGUI();
            if (refreshGUI) refreshGUI();
        }).catch(err => {
            console.error("Jinkies! Failed to load custom categories:", err);
            Utils.regenerateMasterCategories();
            // refresh UI even on error
            const refreshGUI = AppState.getRefreshGUI();
            if (refreshGUI) refreshGUI();
        });

        Renderer.requestRedraw();

        // load map images
        Renderer.loadImages().then(() => {
            AppState.setLoadedMapImg(true);
            Renderer.requestRedraw();
        }).catch(err => console.error('Jinkies! Failed to load images:', err));

        // setup event listeners
        Events.setupEventListeners();

        // initialize spatial index
        const spatialIndex = new Spatial.QuadTree(
            { x: 0, y: 0, width: AppState.WIDTH, height: AppState.HEIGHT }
        );
        AppState.setSpatialIndex(spatialIndex);
    }

    function initUI() {
        // initialize UI after DOM is loaded
        UI.init();

        // set the refresh GUI callback
        AppState.setRefreshGUI(UI.getRefreshGUI());
    }

    // wait for DOM to be ready
    window.addEventListener('load', () => {
        init();
        initUI();
    });

    return {
        tracks: () => AppState.getTracks(),
        requestRedraw: Renderer.requestRedraw,
        TITLE: AppState.TITLE,
        VERSION: AppState.VERSION
    };
})();

// for backward compatibility
window.addEventListener('load', () => {
    HypoTrack;
});
