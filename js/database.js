// database operations using Dexie

const Database = (() => {
    const db = new Dexie(AppState.IDB_KEY);
    
    db.version(4).stores({
        saves: '',
        maps: '',
        categories: '&name',
        folders: '&name'
    }).upgrade(tx => {
        // this empty upgrade function ensures the new stores are created
        // for users upgrading from a previous version without the new stores
    });
    
    db.version(3).stores({
        saves: '',
        maps: '',
        categories: '&name'
    });
    
    db.version(2).stores({
        saves: '',
        maps: ''
    });

    let lastSave = 0;
    const SAVE_DELAY = 2000;

    async function withLock(operation) {
        if (!AppState.getSaveLoadReady()) return;
        AppState.setSaveLoadReady(false);
        try {
            await operation();
        } catch (error) {
            console.error(`Jinkies. An error occurred: ${error.message}`);
            throw error;
        } finally {
            AppState.setSaveLoadReady(true);
            const refreshGUI = AppState.getRefreshGUI();
            if (refreshGUI) refreshGUI();
        }
    }

    const getKey = () => AppState.getSaveName() || 'Autosave';

    return {
        save: async () => {
            if (performance.now() - lastSave < SAVE_DELAY) return;
            lastSave = performance.now();
            await withLock(() => db.saves.put(AppState.getTracks(), getKey()));
        },
        
        load: async () => {
            await withLock(async () => {
                const tracks = (await db.saves.get(getKey())) || [];
                tracks.forEach(track => track.forEach((point, i) => 
                    track[i] = Object.assign(new Models.TrackPoint(), point)
                ));
                AppState.setTracks(tracks);

                // mark spatial index for rebuild
                AppState.setNeedsIndexRebuild(true);
            });
        },
        
        list: () => db.saves.toCollection().primaryKeys(),
        
        delete: async (keyToDelete) => await withLock(() => 
            db.saves.delete(keyToDelete || getKey())
        ),

        saveMap: async (name, imageData) => await withLock(() => 
            db.maps.put(imageData, name)
        ),
        
        loadMap: (name) => db.maps.get(name),
        
        listMaps: () => db.maps.toCollection().primaryKeys(),
        
        deleteMap: async (name) => await withLock(() => 
            db.maps.delete(name)
        ),

        saveCategories: async (categories) => await withLock(() => 
            db.categories.bulkPut(categories)
        ),
        
        deleteCategory: async (categoryName) => await withLock(() => 
            db.categories.delete(categoryName)
        ),
        
        loadCategories: () => db.categories.toArray(),

        saveFolders: async (foldersToSave) => await withLock(() => 
            db.folders.bulkPut(foldersToSave)
        ),
        
        deleteFolder: async (folderName) => await withLock(() => 
            db.folders.delete(folderName)
        ),
        
        loadFolders: () => db.folders.toArray()
    };
})();
