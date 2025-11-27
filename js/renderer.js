// Rendering and drawing operations

const Renderer = (() => {
    // legacy localStorage key for custom maps migration
    const LOCAL_MAPS_KEY = 'hypo-track-local-custom-maps';

    // batch rendering state
    let trackPathCache = new Map();

    function requestRedraw() {
        AppState.setNeedsRedraw(true);
        if (!AppState.getIsRedrawScheduled()) {
            AppState.setIsRedrawScheduled(true);
            requestAnimationFrame(draw);
        }
    }

    async function loadImages() {
        const useCustomMap = AppState.getUseCustomMap();
        const currentMapName = AppState.getCurrentMapName();

        if (useCustomMap && currentMapName !== 'Default') {
            try {
                // check IndexedDB first
                let mapData = await Database.loadMap(currentMapName);

                // then check localStorage for migration
                if (!mapData) {
                    const localMaps = JSON.parse(localStorage.getItem(LOCAL_MAPS_KEY) || '{}');
                    if (localMaps[currentMapName]) {
                        console.log(`Migrating map "${currentMapName}" from localStorage to IndexedDB...`);
                        const arrayBuffer = Utils.base64ToArrayBuffer(localMaps[currentMapName]);

                        await Database.saveMap(currentMapName, new Uint8Array(arrayBuffer));
                        delete localMaps[currentMapName];
                        localStorage.setItem(LOCAL_MAPS_KEY, JSON.stringify(localMaps));

                        mapData = new Uint8Array(arrayBuffer);
                    }
                }

                // found data? load it
                if (mapData) {
                    const blob = new Blob([mapData], { type: 'image/jpeg' });
                    const url = URL.createObjectURL(blob);
                    const customMapImg = new Image();
                    customMapImg.decoding = 'async';
                    await new Promise((resolve, reject) => {
                        customMapImg.onload = () => { URL.revokeObjectURL(url); resolve(); };
                        customMapImg.onerror = (err) => { URL.revokeObjectURL(url); reject(err); };
                        customMapImg.src = url;
                    });
                    AppState.setCustomMapImg(customMapImg);
                    AppState.setLoadedMapImg(true);
                    return;
                } else {
                    console.warn(`Custom map "${currentMapName}" not found. Falling back to default.`);
                    AppState.setUseCustomMap(false);
                }
            } catch (error) {
                console.error('Error loading custom map:', error);
                AppState.setUseCustomMap(false);
            }
        }

        const IMAGE_PATHS = new Map([
            ['nw', '../resources/map_hi-res_NW.webp'],
            ['ne', '../resources/map_hi-res_NE.webp'],
            ['sw', '../resources/map_hi-res_SW.webp'],
            ['se', '../resources/map_hi-res_SE.webp']
        ]);

        try {
            const worker = new Worker('./js/worker.js');

            const paths = Array.from(IMAGE_PATHS.values());
            const result = await new Promise((resolve, reject) => {
                worker.onmessage = ({ data }) => {
                    if (data.error) {
                        reject(new Error(data.error));
                    } else {
                        resolve(data.imgs);
                    }
                };
                worker.onerror = (error) => reject(error);
                worker.postMessage({ paths });
            });

            const urls = [];
            const images = await Promise.all(
                result.map(async (buffer) => {
                    const blob = new Blob([buffer], { type: 'image/webp' });
                    const url = URL.createObjectURL(blob);
                    urls.push(url);
                    const img = new Image();
                    img.decoding = 'async';
                    await new Promise((resolve, reject) => {
                        img.onload = resolve;
                        img.onerror = reject;
                        img.src = url;
                    });
                    return img;
                })
            );

            urls.forEach(url => URL.revokeObjectURL(url));

            const mapImgs = AppState.getMapImgs();
            Object.assign(mapImgs, Object.fromEntries(
                Array.from(IMAGE_PATHS.keys()).map((key, i) => [key, images[i]])
            ));
        } catch (error) {
            console.error('Image loading failed:', error);
            AppState.setMapImgs({});
            throw error;
        }
    }

    function draw() {
        AppState.setIsRedrawScheduled(false);
        if (!AppState.getNeedsRedraw()) return;
        AppState.setNeedsRedraw(false);

        const zMult = Math.pow(AppState.ZOOM_BASE, AppState.getZoomAmt());
        const viewW = 360 / zMult;
        const viewH = viewW * (AppState.HEIGHT / AppState.WIDTH);

        const ctx = AppState.getCtx();

        // clear background
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, AppState.WIDTH, AppState.HEIGHT);

        if (!AppState.getLoadedMapImg()) {
            ctx.fillStyle = '#000';
            ctx.font = '48px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Loading...', AppState.WIDTH / 2, AppState.HEIGHT / 2);
            requestRedraw();
            return;
        }

        drawMap(viewW, viewH);
        drawTracks(viewW, viewH);
    }

    function drawMap(mvw, mvh) {
        const ctx = AppState.getCtx();
        const panLocation = AppState.getPanLocation();

        // ensure mvw/mvh are available if not passed
        if (!mvw) mvw = Utils.mapViewWidth();
        if (!mvh) mvh = Utils.mapViewHeight();

        const topBound = AppState.HEIGHT - AppState.WIDTH / 2;
        const west = panLocation.long;
        const east = west + mvw;
        const north = panLocation.lat;
        const south = north - mvh;

        function drawSection(img, mw, me, mn, ms, qw, qe, qn, qs, offset = 0) {
            let sx = img.width * Math.max(0, Math.min(1, (qw - mw - offset) / (me - mw)));
            let sw = img.width * Math.max(0, Math.min(1, (qe - mw - offset) / (me - mw))) - sx;
            let sy = img.height * Math.max(0, Math.min(1, (qn - mn) / (ms - mn)));
            let sh = img.height * Math.max(0, Math.min(1, (qs - mn) / (ms - mn))) - sy;

            // Clamp to minimum size to avoid degenerate rectangles
            sw = Math.max(1, sw);
            sh = Math.max(1, sh);

            let dx = AppState.WIDTH * (qw - west) / mvw;
            let dw = AppState.WIDTH * (qe - qw) / mvw;
            let dy = (AppState.HEIGHT - topBound) * (qn - north) / (south - north) + topBound;
            let dh = (AppState.HEIGHT - topBound) * (qs - qn) / (south - north);

            // clamp again on destination
            let roundedDx = Math.round(dx);
            let roundedDy = Math.round(dy);
            let roundedDw = Math.max(1, Math.round(dx + dw) - roundedDx);
            let roundedDh = Math.max(1, Math.round(dy + dh) - roundedDy);

            const scaleX = sw / dw;
            const scaleY = sh / dh;
            sw = roundedDw * scaleX;
            sh = roundedDh * scaleY;

            // add a minimal overlap to avoid gaps at extreme zoom
            const overlap = 1;
            if (dw > 0 && dh > 0) {
                roundedDw += overlap;
                roundedDh += overlap;
                sw += overlap * scaleX;
                sh += overlap * scaleY;
            }

            // only draw if everything is valid and in bounds
            if (
                sw > 0 && sh > 0 &&
                roundedDx + roundedDw > 0 && roundedDx < AppState.WIDTH &&
                sx < img.width && sy < img.height
            ) {
                // disable smoothing
                // ctx.imageSmoothingEnabled = false;
                ctx.drawImage(img, sx, sy, sw, sh, roundedDx, roundedDy, roundedDw, roundedDh);
            } else {
                ctx.fillStyle = "#efefef";
                ctx.fillRect(roundedDx, roundedDy, roundedDw, roundedDh);
            }
        }

        const customMapImg = AppState.getCustomMapImg();
        const useCustomMap = AppState.getUseCustomMap();

        if (useCustomMap && customMapImg) {
            const mapNorth = 90;
            const mapSouth = -90;

            // calculate the vertical part of the map to show
            const sy = customMapImg.height * (mapNorth - north) / (mapNorth - mapSouth);
            const sh = customMapImg.height * mvh / (mapNorth - mapSouth);

            // calculate the horizontal part
            // normalize west longitude to be in [0, 360) range for easier calculations
            const sx = customMapImg.width * (west + 180) / 360;
            const sw = customMapImg.width * mvw / 360;

            // calculate destination drawing parameters
            const dy = topBound;
            const dh = AppState.HEIGHT - topBound;
            const dx = 0;
            const dw = AppState.WIDTH;

            // check if the view crosses the antimeridian (180° longitude)
            if (sx + sw > customMapImg.width) {
                // draw the first part (from sx to the right edge of the image)
                const sw1 = customMapImg.width - sx;
                const dw1 = dw * (sw1 / sw);
                ctx.drawImage(customMapImg, sx, sy, sw1, sh, dx, dy, dw1, dh);

                // draw the second part (from the left edge of the image, wrapping around)
                const sw2 = sw - sw1;
                const dw2 = dw - dw1;
                ctx.drawImage(customMapImg, 0, sy, sw2, sh, dx + dw1, dy, dw2, dh);
            } else {
                // if no wrapping, draw the single section
                ctx.drawImage(customMapImg, sx, sy, sw, sh, dx, dy, dw, dh);
            }
        } else {
            const mapImgs = AppState.getMapImgs();
            const northGtZero = north > 0;
            const southLtZero = south < 0;
            const minNorthZero = Math.min(north, 0);
            const maxSouthZero = Math.max(south, 0);

            if (west < 0) {
                if (northGtZero) drawSection(mapImgs.nw, -180, 0, 90, 0, west, Math.min(east, 0), north, maxSouthZero);
                if (southLtZero) drawSection(mapImgs.sw, -180, 0, 0, -90, west, Math.min(east, 0), minNorthZero, south);
            }
            if (east > 0) {
                const maxWestZero = Math.max(west, 0);
                if (northGtZero) drawSection(mapImgs.ne, 0, 180, 90, 0, maxWestZero, Math.min(east, 180), north, maxSouthZero);
                if (southLtZero) drawSection(mapImgs.se, 0, 180, 0, -90, maxWestZero, Math.min(east, 180), minNorthZero, south);
            }
            if (east > 180) {
                if (northGtZero) drawSection(mapImgs.nw, -180, 0, 90, 0, 180, Math.min(east, 360), north, maxSouthZero, 360);
                if (southLtZero) drawSection(mapImgs.sw, -180, 0, 0, -90, 180, Math.min(east, 360), minNorthZero, south, 360);
            }
            if (east > 360) {
                if (northGtZero) drawSection(mapImgs.ne, 0, 180, 90, 0, 360, east, north, maxSouthZero, 360);
                if (southLtZero) drawSection(mapImgs.se, 0, 180, 0, -90, 360, east, minNorthZero, south, 360);
            }
        }
    }

    function buildSpatialIndex() {
        if (!AppState.getNeedsIndexRebuild()) return;

        const spatialIndex = AppState.getSpatialIndex();
        spatialIndex.clear();

        const tracks = AppState.getTracks();

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            for (let j = 0; j < track.length; j++) {
                const point = track[j];
                const screenCoords = Utils.longLatToScreenCoords(point);

                if (screenCoords.inBounds) {
                    const indexPoint = {
                        screenX: screenCoords.x,
                        screenY: screenCoords.y,
                        point: point,
                        track: track
                    };

                    spatialIndex.insert(indexPoint);
                }

                const worldWidth = AppState.WIDTH * Utils.zoomMult();

                // wrapped points for seamless selection across dateline
                const leftPoint = {
                    screenX: screenCoords.x - worldWidth,
                    screenY: screenCoords.y,
                    point: point,
                    track: track
                };
                if (leftPoint.screenX > -100 && leftPoint.screenX < AppState.WIDTH + 100) {
                    spatialIndex.insert(leftPoint);
                }

                const rightPoint = {
                    screenX: screenCoords.x + worldWidth,
                    screenY: screenCoords.y,
                    point: point,
                    track: track
                };
                if (rightPoint.screenX > -100 && rightPoint.screenX < AppState.WIDTH + 100) {
                    spatialIndex.insert(rightPoint);
                }
            }
        }

        AppState.setNeedsIndexRebuild(false);
    }

    function drawTracks() {
        const ctx = AppState.getCtx();
        const baseDotSize = 2 * Math.pow(AppState.ZOOM_BASE, AppState.getZoomAmt());
        ctx.lineWidth = baseDotSize / 9;
        const dotSize = baseDotSize * AppState.getDotSizeMultiplier();
        const worldWidth = AppState.WIDTH * Utils.zoomMult();
        const viewWidth = Utils.mapViewWidth();
        const viewHeight = Utils.mapViewHeight();
        const panLocation = AppState.getPanLocation();
        const tracks = AppState.getTracks();
        const hideNonSelectedTracks = AppState.getHideNonSelectedTracks();
        const selectedTrack = AppState.getSelectedTrack();
        const selectedDot = AppState.getSelectedDot();
        const masterCategories = AppState.getMasterCategories();
        const useAltColors = AppState.getUseAltColors();
        const canvas = AppState.getCanvas();

        // mark the spatial index for rebuild
        AppState.setNeedsIndexRebuild(true);

        // our pool of reusable objects
        const coordsPool = [];
        let poolIndex = 0;

        function getCoords() {
            return coordsPool[poolIndex++] || (coordsPool[poolIndex - 1] = { x: 0, y: 0, inBounds: false });
        }

        function longLatToScreenCoordsPooled(d, out) {
            out.x = ((d.long - panLocation.long + 360) % 360) / viewWidth * AppState.WIDTH;
            out.y = (panLocation.lat - d.lat) / viewHeight * AppState.WIDTH / 2 + AppState.HEIGHT - AppState.WIDTH / 2;
            out.inBounds = out.x >= 0 && out.x < AppState.WIDTH && out.y >= (AppState.HEIGHT - AppState.WIDTH / 2) && out.y < AppState.HEIGHT;
        }

        AppState.setHoverTrack(undefined);
        AppState.setHoverDot(undefined);

        // first pass: draw tracks and points
        const pathsToRender = [];

        for (let i = 0; i < tracks.length; i++) {
            if (!hideNonSelectedTracks || selectedTrack === tracks[i]) {
                const isSelected = selectedTrack === tracks[i] && !hideNonSelectedTracks;
                const strokeStyle = isSelected ? '#ffff00' : '#ffffff';

                const segments = [];
                for (let j = 0; j < tracks[i].length - 1; j++) {
                    const d = tracks[i][j];
                    const d1 = tracks[i][j + 1];
                    const coords = getCoords();
                    const coords1 = getCoords();
                    longLatToScreenCoordsPooled(d, coords);
                    longLatToScreenCoordsPooled(d1, coords1);

                    let x0 = coords.x, x1 = coords1.x;
                    // handle wrapping
                    if (x1 - x0 > worldWidth / 2) x1 -= worldWidth;
                    else if (x1 - x0 < -worldWidth / 2) x1 += worldWidth;

                    segments.push([x0, coords.y, x1, coords1.y]);
                }

                pathsToRender.push({ strokeStyle, segments });
            }
        }

        // render all paths in one batch per stroke style
        const groupedPaths = new Map();
        pathsToRender.forEach(({ strokeStyle, segments }) => {
            if (!groupedPaths.has(strokeStyle)) {
                groupedPaths.set(strokeStyle, []);
            }
            groupedPaths.get(strokeStyle).push(...segments);
        });

        groupedPaths.forEach((allSegments, strokeStyle) => {
            ctx.strokeStyle = strokeStyle;
            ctx.beginPath();
            allSegments.forEach(([x0, y0, x1, y1]) => {
                ctx.moveTo(x0, y0);
                ctx.lineTo(x1, y1);
                // draw copies for wrapping
                ctx.moveTo(x0 - worldWidth, y0);
                ctx.lineTo(x1 - worldWidth, y1);
                ctx.moveTo(x0 + worldWidth, y0);
                ctx.lineTo(x1 + worldWidth, y1);
            });
            ctx.stroke();
        });

        // batch point rendering by color
        const pointsByColor = new Map();

        for (let i = 0; i < tracks.length; i++) {
            if (!hideNonSelectedTracks || selectedTrack === tracks[i]) {
                for (let j = 0; j < tracks[i].length; j++) {
                    const d = tracks[i][j];
                    const coords = getCoords();
                    longLatToScreenCoordsPooled(d, coords);

                    const category = masterCategories[d.cat];
                    const fillStyle = category ? (useAltColors ? category.altColor : category.color) : '#000000';

                    if (!pointsByColor.has(fillStyle)) {
                        pointsByColor.set(fillStyle, []);
                    }

                    pointsByColor.get(fillStyle).push({ d, coords, track: tracks[i] });
                }
            }
        }

        // render points batched by color
        pointsByColor.forEach((points, fillStyle) => {
            ctx.fillStyle = fillStyle;

            points.forEach(({ d, coords, track }) => {
                function mark(x) {
                    if (x >= -dotSize / 2 && x < AppState.WIDTH + dotSize / 2 &&
                        coords.y >= (AppState.HEIGHT - AppState.WIDTH / 2) - dotSize / 2 && coords.y < AppState.HEIGHT + dotSize / 2) {
                        ctx.beginPath();
                        if (d.type === 0) {
                            ctx.arc(x, coords.y, dotSize / 2, 0, Math.PI * 2);
                        } else if (d.type === 1) {
                            const s = dotSize * 0.35;
                            ctx.rect(x - s, coords.y - s, s * 2, s * 2);
                        } else if (d.type === 2) {
                            const r = dotSize / 2.2;
                            ctx.moveTo(x + r * Math.cos(Math.PI / 6), coords.y + r * Math.sin(Math.PI / 6));
                            ctx.lineTo(x + r * Math.cos(5 * Math.PI / 6), coords.y + r * Math.sin(5 * Math.PI / 6));
                            ctx.lineTo(x + r * Math.cos(3 * Math.PI / 2), coords.y + r * Math.sin(3 * Math.PI / 2));
                            ctx.closePath();
                        }
                        ctx.fill();

                        const strokeStyle = hideNonSelectedTracks ? 'transparent' :
                            selectedDot === d ? '#ff0000' :
                                selectedTrack === track ? '#ffff00' :
                                    'transparent';

                        if (strokeStyle !== 'transparent') {
                            ctx.strokeStyle = strokeStyle;
                            ctx.stroke();
                        }
                    }
                }

                mark(coords.x);
                mark(coords.x - worldWidth);
                mark(coords.x + worldWidth);
            });
        });

        // reset pool for future reuse
        poolIndex = 0;

        // second pass: determine hover state
        const mouseX = canvas.mouseX || 0, mouseY = canvas.mouseY || 0;
        if (canvas.mouseX !== undefined && canvas.mouseY !== undefined) {
            for (let i = tracks.length - 1; i >= 0; i--) {
                if (!hideNonSelectedTracks || selectedTrack === tracks[i]) {
                    for (let j = tracks[i].length - 1; j >= 0; j--) {
                        const d = tracks[i][j];
                        const c = getCoords();
                        longLatToScreenCoordsPooled(d, c);
                        if (c.inBounds && Math.hypot(c.x - mouseX, c.y - mouseY) < Math.pow(AppState.ZOOM_BASE, AppState.getZoomAmt())) {
                            AppState.setHoverDot(d);
                            AppState.setHoverTrack(tracks[i]);
                            break;
                        }
                    }
                }
            }
        }
    }

    // centralized zoom helpers
    function setZoomAbsolute(newZoomAmt, pivotX = AppState.WIDTH / 2, pivotY = (AppState.HEIGHT - AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO) + (AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO) / 2) {
        const oldViewW = Utils.mapViewWidth();
        const oldViewH = Utils.mapViewHeight();
        const clamped = Math.max(0, Math.min(15, newZoomAmt));

        // compute new view
        const newViewW = 360 / Math.pow(AppState.ZOOM_BASE, clamped);
        const newViewH = 180 / Math.pow(AppState.ZOOM_BASE, clamped);

        // adjust pan to keep pivot in place
        const topBound = AppState.HEIGHT - AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO;
        const panLocation = AppState.getPanLocation();
        panLocation.long += (oldViewW - newViewW) * (pivotX / AppState.WIDTH);
        panLocation.lat -= (oldViewH - newViewH) * ((pivotY - topBound) / (AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO));

        panLocation.long = Utils.normalizeLongitude(panLocation.long);
        panLocation.lat = Utils.constrainLatitude(panLocation.lat, newViewH);

        AppState.setZoomAmt(clamped);
        const zoomSliderEl = AppState.getZoomSliderEl();
        if (zoomSliderEl) zoomSliderEl.value = String(clamped);
        requestRedraw();
    }

    function setZoomRelative(delta, pivotX, pivotY) {
        setZoomAbsolute(AppState.getZoomAmt() + delta, pivotX, pivotY);
    }

    function createCoordinatesTab(container) {
        const coordTab = document.createElement('div');
        coordTab.id = 'coordinates-tab';
        coordTab.className = 'hidden';
        coordTab.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: #fff;
            padding: .6em .2em;
            border-radius: .2em;
            font-family: "Consolas", "Courier New", monospace;
            font-size: 12px;
            z-index: 1000;
            min-width: 120px;
            text-align: center;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(5px);
            transition: opacity 0.2s ease;
            pointer-events: none;
        `;

        const coordLabel = document.createElement('div');
        coordLabel.className = 'coord-label';
        coordLabel.textContent = 'Coordinates';
        coordLabel.style.cssText = `
            font-size: 10px;
            color: #ccc;
            margin-bottom: 2px;
        `;

        const latElement = document.createElement('div');
        latElement.id = 'coord-lat';
        latElement.className = 'coord-value';
        latElement.textContent = '--';
        latElement.style.cssText = `
            font-weight: bold;
            font-size: 11px;
        `;

        const lonElement = document.createElement('div');
        lonElement.id = 'coord-lon';
        lonElement.className = 'coord-value';
        lonElement.textContent = '--';
        lonElement.style.cssText = `
            font-weight: bold;
            font-size: 11px;
        `;

        coordTab.appendChild(coordLabel);
        coordTab.appendChild(latElement);
        coordTab.appendChild(lonElement);
        container.appendChild(coordTab);

        const style = document.createElement('style');
        style.textContent = `
            #coordinates-tab.hidden {
                opacity: 0;
                pointer-events: none;
            }
            .btn-small { padding: 2px 4px; font-size: 10px; margin-left: 4px; }
        `;
        document.head.appendChild(style);
    }

    // zoom controls overlay
    function createZoomControls(container) {
        const wrap = document.createElement('div');
        wrap.id = 'zoom-controls';
        wrap.style.cssText = `
            position: absolute;
            bottom: 10px;
            right: 10px;
            display: flex;
            align-items: center;
            gap: 6px;
            background: rgba(0,0,0,0.6);
            padding: 6px 8px;
            border-radius: 6px;
            z-index: 1000;
            color: #fff;
            backdrop-filter: blur(3px);
            user-select: none;
        `;

        const btnStyle = `
            background: #2c2c2c; color: #fff; border: 1px solid #555; border-radius: 4px;
            width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
            font-size: 16px; line-height: 1; cursor: pointer;
        `;

        const zoomOutBtnEl = document.createElement('button');
        zoomOutBtnEl.type = 'button';
        zoomOutBtnEl.textContent = '−';
        zoomOutBtnEl.style.cssText = btnStyle;

        const zoomInBtnEl = document.createElement('button');
        zoomInBtnEl.type = 'button';
        zoomInBtnEl.textContent = '+';
        zoomInBtnEl.style.cssText = btnStyle;

        const zoomSliderEl = document.createElement('input');
        zoomSliderEl.type = 'range';
        zoomSliderEl.min = '0';
        zoomSliderEl.max = '15';
        zoomSliderEl.step = '0.25';
        zoomSliderEl.value = String(AppState.getZoomAmt());
        zoomSliderEl.style.cssText = `
            width: 140px;
            accent-color: #6ec1ea;
        `;

        wrap.appendChild(zoomOutBtnEl);
        wrap.appendChild(zoomSliderEl);
        wrap.appendChild(zoomInBtnEl);
        container.appendChild(wrap);

        // store references in state
        AppState.setZoomInBtnEl(zoomInBtnEl);
        AppState.setZoomOutBtnEl(zoomOutBtnEl);
        AppState.setZoomSliderEl(zoomSliderEl);

        const pivotX = AppState.WIDTH / 2;
        const pivotY = (AppState.HEIGHT - AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO) + (AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO) / 2;

        zoomOutBtnEl.addEventListener('click', () => setZoomRelative(-0.5, pivotX, pivotY), { passive: true });
        zoomInBtnEl.addEventListener('click', () => setZoomRelative(0.5, pivotX, pivotY), { passive: true });
        zoomSliderEl.addEventListener('input', () => setZoomAbsolute(parseFloat(zoomSliderEl.value), pivotX, pivotY), { passive: true });
    }

    return {
        requestRedraw,
        draw,
        drawMap,
        drawTracks,
        buildSpatialIndex,
        loadImages,
        setZoomAbsolute,
        setZoomRelative,
        createCoordinatesTab,
        createZoomControls
    };
})();