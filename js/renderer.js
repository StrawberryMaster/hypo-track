// Rendering and drawing operations

const Renderer = (() => {
    const LOCAL_MAPS_KEY = 'hypo-track-local-custom-maps';

    const trackPathCache = new Map();
    const groupedPaths = new Map();
    const pointsByColor = new Map();
    
    // object pool for coordinates
    const coordsPool = [];
    let poolIndex = 0;

    function getCoords() {
        if (poolIndex >= coordsPool.length) {
            coordsPool.push({ x: 0, y: 0, inBounds: false });
        }
        return coordsPool[poolIndex++];
    }

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

        const ctx = AppState.getCtx();
        // clear full canvas
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

        // pre-calculate view metrics once per frame
        const zMult = Math.pow(AppState.ZOOM_BASE, AppState.getZoomAmt());
        const viewW = 360 / zMult;
        const viewH = viewW * (AppState.HEIGHT / AppState.WIDTH);

        drawMap(viewW, viewH);
        drawTracks(viewW, viewH);
    }

    function drawMap(mvw, mvh) {
        const ctx = AppState.getCtx();
        const panLocation = AppState.getPanLocation();
        const width = AppState.WIDTH;
        const height = AppState.HEIGHT;

        if (!mvw) mvw = Utils.mapViewWidth();
        if (!mvh) mvh = Utils.mapViewHeight();

        const topBound = height - width / 2;
        const west = panLocation.long;
        const north = panLocation.lat;
        const south = north - mvh;
        
        // helper for clamping 0-1
        const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

        function drawSection(img, mw, me, mn, ms, qw, qe, qn, qs, offset = 0) {
            const rangeW = me - mw;
            const rangeH = ms - mn;
            
            let sx = img.width * clamp01((qw - mw - offset) / rangeW);
            let sw = img.width * clamp01((qe - mw - offset) / rangeW) - sx;
            let sy = img.height * clamp01((qn - mn) / rangeH);
            let sh = img.height * clamp01((qs - mn) / rangeH) - sy;

            sw = Math.max(1, sw);
            sh = Math.max(1, sh);

            // dest dimensions
            let dx = width * (qw - west) / mvw;
            let dw = width * (qe - qw) / mvw;
            let dy = (height - topBound) * (qn - north) / (south - north) + topBound;
            let dh = (height - topBound) * (qs - qn) / (south - north);

            const rDx = Math.round(dx);
            const rDy = Math.round(dy);
            let rDw = Math.max(1, Math.round(dx + dw) - rDx);
            let rDh = Math.max(1, Math.round(dy + dh) - rDy);

            // recalculate source width based on snapped destination to avoid drift
            const scaleX = sw / dw;
            const scaleY = sh / dh;
            sw = rDw * scaleX;
            sh = rDh * scaleY;

            // add a minimal overlap to avoid gaps at extreme zoom
            const overlap = 1;
            if (dw > 0 && dh > 0) {
                rDw += overlap;
                rDh += overlap;
                sw += overlap * scaleX;
                sh += overlap * scaleY;
            }

            // only draw if everything is valid and in bounds
            if (sw > 0 && sh > 0 && rDx + rDw > 0 && rDx < width && sx < img.width && sy < img.height) {
                ctx.drawImage(img, sx, sy, sw, sh, rDx, rDy, rDw, rDh);
            } else {
                ctx.fillStyle = "#efefef";
                ctx.fillRect(rDx, rDy, rDw, rDh);
            }
        }

        const customMapImg = AppState.getCustomMapImg();
        
        if (AppState.getUseCustomMap() && customMapImg) {
            const mapNorth = 90;
            const mapSouth = -90;
            const sy = customMapImg.height * (mapNorth - north) / (mapNorth - mapSouth);
            const sh = customMapImg.height * mvh / (mapNorth - mapSouth);
            const sx = customMapImg.width * (west + 180) / 360;
            const sw = customMapImg.width * mvw / 360;

            const dy = topBound;
            const dh = height - topBound;

            if (sx + sw > customMapImg.width) {
                const sw1 = customMapImg.width - sx;
                const dw1 = width * (sw1 / sw);
                ctx.drawImage(customMapImg, sx, sy, sw1, sh, 0, dy, dw1, dh);
                ctx.drawImage(customMapImg, 0, sy, sw - sw1, sh, dw1, dy, width - dw1, dh);
            } else {
                ctx.drawImage(customMapImg, sx, sy, sw, sh, 0, dy, width, dh);
            }
        } else {
            // tiled map logic
            const mapImgs = AppState.getMapImgs();
            const east = west + mvw;
            const minNorthZero = Math.min(north, 0);
            const maxSouthZero = Math.max(south, 0);

            // only call drawSection if actually visible
            if (west < 0) {
                if (north > 0) drawSection(mapImgs.nw, -180, 0, 90, 0, west, Math.min(east, 0), north, maxSouthZero);
                if (south < 0) drawSection(mapImgs.sw, -180, 0, 0, -90, west, Math.min(east, 0), minNorthZero, south);
            }
            if (east > 0) {
                const maxWestZero = Math.max(west, 0);
                if (north > 0) drawSection(mapImgs.ne, 0, 180, 90, 0, maxWestZero, Math.min(east, 180), north, maxSouthZero);
                if (south < 0) drawSection(mapImgs.se, 0, 180, 0, -90, maxWestZero, Math.min(east, 180), minNorthZero, south);
            }
            // wrapping cases
            if (east > 180) {
                if (north > 0) drawSection(mapImgs.nw, -180, 0, 90, 0, 180, Math.min(east, 360), north, maxSouthZero, 360);
                if (south < 0) drawSection(mapImgs.sw, -180, 0, 0, -90, 180, Math.min(east, 360), minNorthZero, south, 360);
            }
            if (east > 360) {
                if (north > 0) drawSection(mapImgs.ne, 0, 180, 90, 0, 360, east, north, maxSouthZero, 360);
                if (south < 0) drawSection(mapImgs.se, 0, 180, 0, -90, 360, east, minNorthZero, south, 360);
            }
        }
    }

    function buildSpatialIndex() {
        if (!AppState.getNeedsIndexRebuild()) return;

        const spatialIndex = AppState.getSpatialIndex();
        spatialIndex.clear();

        const tracks = AppState.getTracks();
        const panLocation = AppState.getPanLocation();
        const viewWidth = Utils.mapViewWidth();
        const viewHeight = Utils.mapViewHeight();
        const worldWidth = AppState.WIDTH * Utils.zoomMult();
        const appWidth = AppState.WIDTH;
        const appHeight = AppState.HEIGHT;
        const topBound = appHeight - appWidth / 2;

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            for (let j = 0; j < track.length; j++) {
                const point = track[j];
                
                // manual projection for speed inside the loop
                const x = ((point.long - panLocation.long + 360) % 360) / viewWidth * appWidth;
                const y = (panLocation.lat - point.lat) / viewHeight * appWidth / 2 + topBound;
                
                const inBounds = x >= 0 && x < appWidth && y >= topBound && y < appHeight;

                if (inBounds) {
                    spatialIndex.insert({ screenX: x, screenY: y, point, track });
                }

                // handle wrapped points
                const leftX = x - worldWidth;
                if (leftX > -100 && leftX < appWidth + 100) {
                    spatialIndex.insert({ screenX: leftX, screenY: y, point, track });
                }
                const rightX = x + worldWidth;
                if (rightX > -100 && rightX < appWidth + 100) {
                    spatialIndex.insert({ screenX: rightX, screenY: y, point, track });
                }
            }
        }
        AppState.setNeedsIndexRebuild(false);
    }

    function drawTracks(viewWidth, viewHeight) {
        const ctx = AppState.getCtx();
        
        const zoomBase = Math.pow(AppState.ZOOM_BASE, AppState.getZoomAmt());
        const baseDotSize = 2 * zoomBase;
        const dotSize = baseDotSize * AppState.getDotSizeMultiplier();
        const worldWidth = AppState.WIDTH * Utils.zoomMult();
        const panLocation = AppState.getPanLocation();
        const tracks = AppState.getTracks();
        const hideNonSelectedTracks = AppState.getHideNonSelectedTracks();
        const selectedTrack = AppState.getSelectedTrack();
        const selectedDot = AppState.getSelectedDot();
        const masterCategories = AppState.getMasterCategories();
        const useAltColors = AppState.getUseAltColors();
        const appWidth = AppState.WIDTH;
        const appHeight = AppState.HEIGHT;
        const topBound = appHeight - appWidth / 2;

        ctx.lineWidth = baseDotSize / 9;

        // reset object pool and batches
        poolIndex = 0;
        groupedPaths.clear();
        pointsByColor.clear();

        // calculate coordinates, batch lines & batch points
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            
            if (hideNonSelectedTracks && selectedTrack !== track) continue;

            const isSelected = selectedTrack === track;
            const strokeStyle = isSelected ? '#ffff00' : '#ffffff';

            if (!groupedPaths.has(strokeStyle)) groupedPaths.set(strokeStyle, []);
            const pathSegments = groupedPaths.get(strokeStyle);

            let prevX = null, prevY = null;

            for (let j = 0; j < track.length; j++) {
                const d = track[j];
                const coords = getCoords();
                
                // inline projection
                coords.x = ((d.long - panLocation.long + 360) % 360) / viewWidth * appWidth;
                coords.y = (panLocation.lat - d.lat) / viewHeight * appWidth / 2 + topBound;
                
                // add to line batch
                if (prevX !== null) {
                    let x0 = prevX, x1 = coords.x;
                    // handle line wrapping
                    if (x1 - x0 > worldWidth / 2) x1 -= worldWidth;
                    else if (x1 - x0 < -worldWidth / 2) x1 += worldWidth;
                    pathSegments.push(x0, prevY, x1, coords.y);
                }
                
                prevX = coords.x;
                prevY = coords.y;

                // add to point batch
                const category = masterCategories[d.cat];
                const fillStyle = category ? (useAltColors ? category.altColor : category.color) : '#000000';
                
                if (!pointsByColor.has(fillStyle)) pointsByColor.set(fillStyle, []);
                // store minimal data needed for rendering
                pointsByColor.get(fillStyle).push({ 
                    x: coords.x, 
                    y: coords.y, 
                    d, 
                    track 
                });
            }
        }

        // render Lines
        groupedPaths.forEach((segments, strokeStyle) => {
            ctx.strokeStyle = strokeStyle;
            ctx.beginPath();
            for (let i = 0; i < segments.length; i += 4) {
                const x0 = segments[i], y0 = segments[i+1];
                const x1 = segments[i+2], y1 = segments[i+3];
                
                ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
                ctx.moveTo(x0 - worldWidth, y0); ctx.lineTo(x1 - worldWidth, y1);
                ctx.moveTo(x0 + worldWidth, y0); ctx.lineTo(x1 + worldWidth, y1);
            }
            ctx.stroke();
        });

        // render points
        pointsByColor.forEach((points, fillStyle) => {
            ctx.fillStyle = fillStyle;
            
            // check bounds once per point here
            const yMin = topBound - dotSize / 2;
            const yMax = appHeight + dotSize / 2;

            for(let i = 0; i < points.length; i++) {
                const {x, y, d, track} = points[i];
                
                // simple bounds check
                if (y < yMin || y > yMax) continue;

                // helper to draw specific shape
                const drawShape = (cx) => {
                    if (cx < -dotSize || cx > appWidth + dotSize) return;

                    ctx.beginPath();
                    if (d.type === 0) {
                        ctx.arc(cx, y, dotSize / 2, 0, Math.PI * 2);
                    } else if (d.type === 1) {
                        const s = dotSize * 0.35;
                        ctx.rect(cx - s, y - s, s * 2, s * 2);
                    } else if (d.type === 2) {
                        const r = dotSize / 2.2;
                        // pre-calculate shape offsets?
                        ctx.moveTo(cx + r * 0.866, y + r * 0.5); // cos30, sin30
                        ctx.lineTo(cx - r * 0.866, y + r * 0.5);
                        ctx.lineTo(cx, y - r);
                        ctx.closePath();
                    }
                    ctx.fill();

                    // selection / hover highlights
                    const isSelectedDot = selectedDot === d;
                    const isSelectedTrack = selectedTrack === track;
                    const isHoverDot = AppState.getHoverDot() === d;
                    
                    if (isSelectedDot || isSelectedTrack || isHoverDot) {
                        ctx.strokeStyle = isSelectedDot ? '#ff0000' : 
                                         (isSelectedTrack ? '#ffff00' : 'rgba(255,255,255,0.5)');
                        ctx.stroke();
                    }
                };

                drawShape(x);
                drawShape(x - worldWidth);
                drawShape(x + worldWidth);
            }
        });
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
        
        // note: changing zoom invalidates the screen-coordinate spatial index
        AppState.setNeedsIndexRebuild(true);
        
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