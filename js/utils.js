// utility functions for coordinates, formatting, and helpers

const Utils = (() => {
    
    // coordinate parsing and formatting
    function parseCoordinate(str) {
        if (typeof str !== 'string') return parseFloat(str) || 0;
        let value = parseFloat(str);
        const lastChar = str.trim().slice(-1).toUpperCase();
        if (lastChar === 'S' || lastChar === 'W') value = -value;
        return value;
    }

    function normalizeLongitude(long) {
        return ((long + 180) % 360 + 360) % 360 - 180;
    }

    function constrainLatitude(lat, viewHeight) {
        return Math.min(90, Math.max(-90 + viewHeight, lat));
    }

    function formatLatLon(val, isLat, decimalPlaces = 1) {
        let adjustedVal = isLat ? val : normalizeLongitude(val);
        const absVal = Math.abs(adjustedVal);
        const hemisphere = isLat ? (adjustedVal >= 0 ? 'N' : 'S') : (adjustedVal >= 0 ? 'E' : 'W');
        return absVal.toFixed(decimalPlaces) + hemisphere;
    }

    function formatCoordinate(value, isLatitude) {
        const abs = Math.abs(value);
        const direction = isLatitude ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
        return `${abs.toFixed(2)}°${direction}`;
    }

    // zoom and view calculations
    function zoomMult() {
        return Math.pow(AppState.ZOOM_BASE, AppState.getZoomAmt());
    }

    function mapViewWidth() {
        return 360 / zoomMult();
    }

    function mapViewHeight() {
        return 180 / zoomMult();
    }

    // mouse position utilities
    function mouseLong(evt) {
        return AppState.getPanLocation().long + (evt.offsetX * mapViewWidth()) / AppState.WIDTH;
    }

    function mouseLat(evt) {
        const relativeY = evt.offsetY - (AppState.HEIGHT - AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO);
        return AppState.getPanLocation().lat - (relativeY * mapViewHeight()) / (AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO);
    }

    function isValidMousePosition(evt) {
        const x = evt.offsetX, y = evt.offsetY;
        return x > 0 && x < AppState.WIDTH && y > (AppState.HEIGHT - AppState.WIDTH / 2) && y < AppState.HEIGHT;
    }

    function isValidPositionXY(x, y) {
        return x > 0 && x < AppState.WIDTH && y > (AppState.HEIGHT - AppState.WIDTH / 2) && y < AppState.HEIGHT;
    }

    function longLatToScreenCoords({ long, lat }) {
        const viewWidth = mapViewWidth();
        const viewHeight = mapViewHeight();
        const topBound = AppState.HEIGHT - AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO;
        const panLocation = AppState.getPanLocation();
        const x = ((long - panLocation.long + 360) % 360) * AppState.WIDTH / viewWidth;
        const y = (panLocation.lat - lat) * (AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO) / viewHeight + topBound;
        return { x, y, inBounds: x >= 0 && x < AppState.WIDTH && y >= topBound && y < AppState.HEIGHT };
    }

    // number formatting
    const padCache = new Map();
    function padNumber(num, width) {
        const key = num * 100 + width;
        let padded = padCache.get(key);
        if (!padded) {
            padded = num.toString().padStart(width, '0');
            if (padCache.size < 1000) padCache.set(key, padded);
        }
        return padded;
    }

    // data conversion
    function arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    function base64ToArrayBuffer(b64) {
        const binary = atob(b64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // track selection
    function deselectTrack() {
        AppState.setSelectedTrack(undefined);
        AppState.setSelectedDot(undefined);
        AppState.setHoverTrack(undefined);
        AppState.setHoverDot(undefined);
        if (AppState.getHideNonSelectedTracks()) {
            AppState.setHideNonSelectedTracks(false);
        }
        const refreshGUI = AppState.getRefreshGUI();
        if (refreshGUI) refreshGUI();
        Renderer.requestRedraw();
    }

    // coordinate display
    function updateCoordinatesDisplay() {
        const coordTab = document.getElementById('coordinates-tab');
        const latElement = document.getElementById('coord-lat');
        const lonElement = document.getElementById('coord-lon');
        const selectedDot = AppState.getSelectedDot();

        if (selectedDot) {
            coordTab.classList.remove('hidden');
            latElement.textContent = formatCoordinate(selectedDot.lat, true);
            lonElement.textContent = formatCoordinate(selectedDot.long, false);
        } else {
            coordTab.classList.add('hidden');
            latElement.textContent = '--';
            lonElement.textContent = '--';
        }
    }

    // touch utilities
    function getOffsetFromTouch(touch) {
        const canvas = AppState.getCanvas();
        const rect = canvas.getBoundingClientRect();
        return {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
        };
    }

    function distanceBetweenTouches(t1, t2) {
        const dx = t2.clientX - t1.clientX;
        const dy = t2.clientY - t1.clientY;
        return Math.hypot(dx, dy);
    }

    function midpointBetweenTouches(t1, t2) {
        const canvas = AppState.getCanvas();
        const rect = canvas.getBoundingClientRect();
        return {
            x: (t1.clientX + t2.clientX) / 2 - rect.left,
            y: (t1.clientY + t2.clientY) / 2 - rect.top
        };
    }

    // regenerate master categories from default and custom
    function regenerateMasterCategories() {
        const masterCategories = [...Models.DEFAULT_CATEGORIES, ...AppState.getCustomCategories()];
        AppState.setMasterCategories(masterCategories);
        const refreshGUI = AppState.getRefreshGUI();
        if (refreshGUI) {
            refreshGUI();
        }
    }

    function setHardwareAcceleration(enabled) {
        const canvas = AppState.getCanvas();
        if (!canvas) return;
        if (enabled) {
            canvas.style.willChange = 'transform';
            canvas.style.transform = 'translate3d(0,0,0)';
        } else {
            canvas.style.willChange = 'auto';
            canvas.style.transform = 'none';
        }
    }

    return {
        parseCoordinate,
        normalizeLongitude,
        constrainLatitude,
        formatLatLon,
        formatCoordinate,
        zoomMult,
        mapViewWidth,
        mapViewHeight,
        mouseLong,
        mouseLat,
        isValidMousePosition,
        isValidPositionXY,
        longLatToScreenCoords,
        padNumber,
        arrayBufferToBase64,
        base64ToArrayBuffer,
        deselectTrack,
        updateCoordinatesDisplay,
        getOffsetFromTouch,
        distanceBetweenTouches,
        midpointBetweenTouches,
        regenerateMasterCategories,
        setHardwareAcceleration
    };
})();
