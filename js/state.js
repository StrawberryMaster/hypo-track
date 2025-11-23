// application state management

const AppState = (() => {
    const TITLE = 'HypoTrack';
    const VERSION = '1.1.0';
    const IDB_KEY = 'hypo-track';
    const WIDTH = 1000;
    const HEIGHT = 500;
    const ZOOM_BASE = 1.25;
    const VIEW_HEIGHT_RATIO = 0.5;

    // canvas and rendering state
    let canvas = null;
    let ctx = null;
    let mapImgs = {};
    let customMapImg = null;
    let useCustomMap = false;
    let currentMapName = 'Default';
    let loadedMapImg = false;

    // map and view state
    let panLocation = null;
    let zoomAmt = 0;

    // track data
    let tracks = [];
    let folders = [];
    let currentView = { type: 'root' };
    let selectedBrowserItems = new Set();

    // selection state
    let hoverDot = undefined;
    let hoverTrack = undefined;
    let selectedDot = undefined;
    let selectedTrack = undefined;

    // tool state
    let categoryToPlace = 0;
    let typeToPlace = 0;
    let deleteTrackPoints = false;

    // view options
    let hideNonSelectedTracks = false;
    let useAltColors = false;
    let dotSizeMultiplier = 1.0;

    // save/load state
    let saveName = undefined;
    let autosave = true;
    let saveLoadReady = true;

    // mouse/interaction state
    let isDragging = false;
    let beginClickX = undefined;
    let beginClickY = undefined;
    let beginPanX = undefined;
    let beginPanY = undefined;
    let beginPointMoveLong = undefined;
    let beginPointMoveLat = undefined;
    let mouseMode = undefined;

    // touch state
    let isTouching = false;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchLastX = 0;
    let touchLastY = 0;
    let touchStartedInside = false;
    let pinch = { active: false, startDist: 0, startZoom: 0, startCenterX: 0, startCenterY: 0 };
    let suppressNextTap = false;

    // categories
    let customCategories = [];
    let masterCategories = [];

    // spatial indexing
    let spatialIndex = null;
    let needsIndexRebuild = true;

    // redraw control
    let needsRedraw = true;
    let isRedrawScheduled = false;

    // UI elements
    let zoomInBtnEl = null;
    let zoomOutBtnEl = null;
    let zoomSliderEl = null;

    // GUI refresh callback
    let refreshGUI = null;

    return {
        TITLE, VERSION, IDB_KEY, WIDTH, HEIGHT, ZOOM_BASE, VIEW_HEIGHT_RATIO,

        // getters and setters for state
        getCanvas: () => canvas,
        setCanvas: (c) => canvas = c,
        getCtx: () => ctx,
        setCtx: (c) => ctx = c,
        getMapImgs: () => mapImgs,
        setMapImgs: (m) => mapImgs = m,
        getCustomMapImg: () => customMapImg,
        setCustomMapImg: (img) => customMapImg = img,
        getUseCustomMap: () => useCustomMap,
        setUseCustomMap: (val) => useCustomMap = val,
        getCurrentMapName: () => currentMapName,
        setCurrentMapName: (name) => currentMapName = name,
        getLoadedMapImg: () => loadedMapImg,
        setLoadedMapImg: (val) => loadedMapImg = val,

        getPanLocation: () => panLocation,
        setPanLocation: (loc) => panLocation = loc,
        getZoomAmt: () => zoomAmt,
        setZoomAmt: (amt) => zoomAmt = amt,

        getTracks: () => tracks,
        setTracks: (t) => tracks = t,
        getFolders: () => folders,
        setFolders: (f) => folders = f,
        getCurrentView: () => currentView,
        setCurrentView: (v) => currentView = v,
        getSelectedBrowserItems: () => selectedBrowserItems,

        getHoverDot: () => hoverDot,
        setHoverDot: (d) => hoverDot = d,
        getHoverTrack: () => hoverTrack,
        setHoverTrack: (t) => hoverTrack = t,
        getSelectedDot: () => selectedDot,
        setSelectedDot: (d) => selectedDot = d,
        getSelectedTrack: () => selectedTrack,
        setSelectedTrack: (t) => selectedTrack = t,

        getCategoryToPlace: () => categoryToPlace,
        setCategoryToPlace: (c) => categoryToPlace = c,
        getTypeToPlace: () => typeToPlace,
        setTypeToPlace: (t) => typeToPlace = t,
        getDeleteTrackPoints: () => deleteTrackPoints,
        setDeleteTrackPoints: (val) => deleteTrackPoints = val,

        getHideNonSelectedTracks: () => hideNonSelectedTracks,
        setHideNonSelectedTracks: (val) => hideNonSelectedTracks = val,
        getUseAltColors: () => useAltColors,
        setUseAltColors: (val) => useAltColors = val,
        getDotSizeMultiplier: () => dotSizeMultiplier,
        setDotSizeMultiplier: (val) => dotSizeMultiplier = val,

        getSaveName: () => saveName,
        setSaveName: (name) => saveName = name,
        getAutosave: () => autosave,
        setAutosave: (val) => autosave = val,
        getSaveLoadReady: () => saveLoadReady,
        setSaveLoadReady: (val) => saveLoadReady = val,

        getIsDragging: () => isDragging,
        setIsDragging: (val) => isDragging = val,
        getBeginClickX: () => beginClickX,
        setBeginClickX: (x) => beginClickX = x,
        getBeginClickY: () => beginClickY,
        setBeginClickY: (y) => beginClickY = y,
        getBeginPanX: () => beginPanX,
        setBeginPanX: (x) => beginPanX = x,
        getBeginPanY: () => beginPanY,
        setBeginPanY: (y) => beginPanY = y,
        getBeginPointMoveLong: () => beginPointMoveLong,
        setBeginPointMoveLong: (l) => beginPointMoveLong = l,
        getBeginPointMoveLat: () => beginPointMoveLat,
        setBeginPointMoveLat: (l) => beginPointMoveLat = l,
        getMouseMode: () => mouseMode,
        setMouseMode: (m) => mouseMode = m,

        getIsTouching: () => isTouching,
        setIsTouching: (val) => isTouching = val,
        getTouchStartX: () => touchStartX,
        setTouchStartX: (x) => touchStartX = x,
        getTouchStartY: () => touchStartY,
        setTouchStartY: (y) => touchStartY = y,
        getTouchLastX: () => touchLastX,
        setTouchLastX: (x) => touchLastX = x,
        getTouchLastY: () => touchLastY,
        setTouchLastY: (y) => touchLastY = y,
        getTouchStartedInside: () => touchStartedInside,
        setTouchStartedInside: (val) => touchStartedInside = val,
        getPinch: () => pinch,
        setSuppressNextTap: (val) => suppressNextTap = val,
        getSuppressNextTap: () => suppressNextTap,

        getCustomCategories: () => customCategories,
        setCustomCategories: (cats) => customCategories = cats,
        getMasterCategories: () => masterCategories,
        setMasterCategories: (cats) => masterCategories = cats,

        getSpatialIndex: () => spatialIndex,
        setSpatialIndex: (idx) => spatialIndex = idx,
        getNeedsIndexRebuild: () => needsIndexRebuild,
        setNeedsIndexRebuild: (val) => needsIndexRebuild = val,

        getNeedsRedraw: () => needsRedraw,
        setNeedsRedraw: (val) => needsRedraw = val,
        getIsRedrawScheduled: () => isRedrawScheduled,
        setIsRedrawScheduled: (val) => isRedrawScheduled = val,

        getZoomInBtnEl: () => zoomInBtnEl,
        setZoomInBtnEl: (el) => zoomInBtnEl = el,
        getZoomOutBtnEl: () => zoomOutBtnEl,
        setZoomOutBtnEl: (el) => zoomOutBtnEl = el,
        getZoomSliderEl: () => zoomSliderEl,
        setZoomSliderEl: (el) => zoomSliderEl = el,

        getRefreshGUI: () => refreshGUI,
        setRefreshGUI: (fn) => refreshGUI = fn
    };
})();
