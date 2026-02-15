// Rendering and drawing operations

const Renderer = (() => {
    const LOCAL_MAPS_KEY = 'hypo-track-local-custom-maps';

    const groupedPaths = new Map();
    const pointsByColor = new Map();

    // object pool for coordinates
    const coordsPool = [];
    let poolIndex = 0;

    let lastRenderPanLong = null;
    let lastRenderPanLat = null;
    let lastRenderZoom = null;

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
                let mapData = await Database.loadMap(currentMapName);

                if (!mapData) {
                    const localMaps = JSON.parse(localStorage.getItem(LOCAL_MAPS_KEY) || '{}');
                    if (localMaps[currentMapName]) {
                        const arrayBuffer = Utils.base64ToArrayBuffer(localMaps[currentMapName]);
                        await Database.saveMap(currentMapName, new Uint8Array(arrayBuffer));
                        delete localMaps[currentMapName];
                        localStorage.setItem(LOCAL_MAPS_KEY, JSON.stringify(localMaps));
                        mapData = new Uint8Array(arrayBuffer);
                    }
                }

                if (mapData) {
                    const blob = new Blob([mapData], { type: 'image/jpeg' });
                    const bitmap = await createImageBitmap(blob);
                    AppState.setCustomMapImg(bitmap);
                    AppState.setLoadedMapImg(true);
                    return;
                } else {
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
                worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.imgs);
                worker.onerror = (error) => reject(error);
                worker.postMessage({ paths });
            });

            const images = await Promise.all(
                result.map(async (buffer) => {
                    const blob = new Blob([buffer], { type: 'image/webp' });
                    return createImageBitmap(blob);
                })
            );
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

        const zMult = Math.pow(AppState.ZOOM_BASE, AppState.getZoomAmt());
        const viewW = 360 / zMult;
        const viewH = viewW * (AppState.HEIGHT / AppState.WIDTH);

        // detect if pan/zoom changed since last frame to mark index dirty
        const pan = AppState.getPanLocation();
        const zoom = AppState.getZoomAmt();

        if (pan.long !== lastRenderPanLong || pan.lat !== lastRenderPanLat || zoom !== lastRenderZoom) {
            AppState.setNeedsIndexRebuild(true);
            lastRenderPanLong = pan.long;
            lastRenderPanLat = pan.lat;
            lastRenderZoom = zoom;
        }

        drawMap(viewW, viewH);
        if (AppState.getConeVisible()) {
            drawCone(viewW, viewH);
        }
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

            let dx = width * (qw - west) / mvw;
            let dw = width * (qe - qw) / mvw;
            let dy = (height - topBound) * (qn - north) / (south - north) + topBound;
            let dh = (height - topBound) * (qs - qn) / (south - north);

            const rDx = Math.round(dx);
            const rDy = Math.round(dy);
            let rDw = Math.max(1, Math.round(dx + dw) - rDx);
            let rDh = Math.max(1, Math.round(dy + dh) - rDy);

            const scaleX = sw / dw;
            const scaleY = sh / dh;
            sw = rDw * scaleX;
            sh = rDh * scaleY;

            const overlap = 1;
            if (dw > 0 && dh > 0) {
                rDw += overlap;
                rDh += overlap;
                sw += overlap * scaleX;
                sh += overlap * scaleY;
            }

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
            const mapImgs = AppState.getMapImgs();
            const east = west + mvw;
            const minNorthZero = Math.min(north, 0);
            const maxSouthZero = Math.max(south, 0);

            if (west < 0) {
                if (north > 0) drawSection(mapImgs.nw, -180, 0, 90, 0, west, Math.min(east, 0), north, maxSouthZero);
                if (south < 0) drawSection(mapImgs.sw, -180, 0, 0, -90, west, Math.min(east, 0), minNorthZero, south);
            }
            if (east > 0) {
                const maxWestZero = Math.max(west, 0);
                if (north > 0) drawSection(mapImgs.ne, 0, 180, 90, 0, maxWestZero, Math.min(east, 180), north, maxSouthZero);
                if (south < 0) drawSection(mapImgs.se, 0, 180, 0, -90, maxWestZero, Math.min(east, 180), minNorthZero, south);
            }
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
                const x = ((point.long - panLocation.long + 360) % 360) / viewWidth * appWidth;
                const y = (panLocation.lat - point.lat) / viewHeight * appWidth / 2 + topBound;
                const inBounds = x >= 0 && x < appWidth && y >= topBound && y < appHeight;

                if (inBounds) {
                    spatialIndex.insert({ screenX: x, screenY: y, point, track });
                }

                const leftX = x - worldWidth;
                if (leftX > -100 && leftX < appWidth + 100) spatialIndex.insert({ screenX: leftX, screenY: y, point, track });

                const rightX = x + worldWidth;
                if (rightX > -100 && rightX < appWidth + 100) spatialIndex.insert({ screenX: rightX, screenY: y, point, track });
            }
        }
        AppState.setNeedsIndexRebuild(false);
    }

    function drawTracks(viewWidth, viewHeight) {
        const ctx = AppState.getCtx();
        const canvas = AppState.getCanvas();

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

        // hover hit testing constants
        const mouseX = canvas.mouseX;
        const mouseY = canvas.mouseY;
        const hasMouse = mouseX !== undefined && mouseY !== undefined;
        let newHoverDot = undefined;
        let newHoverTrack = undefined;
        const hoverThreshSq = (zoomBase * zoomBase);

        ctx.lineWidth = baseDotSize / 9;

        poolIndex = 0;
        groupedPaths.clear();

        const pointsToRender = [];

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            if (hideNonSelectedTracks && selectedTrack !== track) continue;

            const isSelected = selectedTrack === track && !hideNonSelectedTracks;
            const strokeStyle = isSelected ? '#ffff00' : '#ffffff';

            if (!groupedPaths.has(strokeStyle)) groupedPaths.set(strokeStyle, []);
            const pathSegments = groupedPaths.get(strokeStyle);

            let prevX = null, prevY = null;

            for (let j = 0; j < track.length; j++) {
                const d = track[j];
                const coords = getCoords();

                coords.x = ((d.long - panLocation.long + 360) % 360) / viewWidth * appWidth;
                coords.y = (panLocation.lat - d.lat) / viewHeight * appWidth / 2 + topBound;

                // line segments logic
                if (prevX !== null) {
                    let x0 = prevX, x1 = coords.x;
                    if (x1 - x0 > worldWidth / 2) x1 -= worldWidth;
                    else if (x1 - x0 < -worldWidth / 2) x1 += worldWidth;
                    pathSegments.push(x0, prevY, x1, coords.y);
                }
                prevX = coords.x;
                prevY = coords.y;

                // color calculation
                const category = masterCategories[d.cat];
                const fillStyle = category ? (useAltColors ? category.altColor : category.color) : '#000000';

                pointsToRender.push({
                    x: coords.x,
                    y: coords.y,
                    d,
                    track,
                    fillStyle
                });

                // hover logic
                if (hasMouse) {
                    let distSq = (coords.x - mouseX) ** 2 + (coords.y - mouseY) ** 2;
                    if (distSq < hoverThreshSq) {
                        newHoverDot = d;
                        newHoverTrack = track;
                    } else {
                        // check wrapped points if main didn't hit
                        const leftX = coords.x - worldWidth;
                        distSq = (leftX - mouseX) ** 2 + (coords.y - mouseY) ** 2;
                        if (distSq < hoverThreshSq) {
                            newHoverDot = d;
                            newHoverTrack = track;
                        } else {
                            const rightX = coords.x + worldWidth;
                            distSq = (rightX - mouseX) ** 2 + (coords.y - mouseY) ** 2;
                            if (distSq < hoverThreshSq) {
                                newHoverDot = d;
                                newHoverTrack = track;
                            }
                        }
                    }
                }
            }
        }

        AppState.setHoverDot(newHoverDot);
        AppState.setHoverTrack(newHoverTrack);

        // rendering lines
        groupedPaths.forEach((segments, strokeStyle) => {
            ctx.strokeStyle = strokeStyle;
            ctx.beginPath();
            for (let i = 0; i < segments.length; i += 4) {
                const x0 = segments[i], y0 = segments[i + 1];
                const x1 = segments[i + 2], y1 = segments[i + 3];
                ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
                ctx.moveTo(x0 - worldWidth, y0); ctx.lineTo(x1 - worldWidth, y1);
                ctx.moveTo(x0 + worldWidth, y0); ctx.lineTo(x1 + worldWidth, y1);
            }
            ctx.stroke();
        });

        // rendering points
        const yMin = topBound - dotSize / 2;
        const yMax = appHeight + dotSize / 2;
        let lastFillStyle = null;

        for (let i = 0; i < pointsToRender.length; i++) {
            const { x, y, d, track, fillStyle } = pointsToRender[i];

            // viewport culling
            if (y < yMin || y > yMax) continue;

            // only switch context color if it changed from the previous point
            if (fillStyle !== lastFillStyle) {
                ctx.fillStyle = fillStyle;
                lastFillStyle = fillStyle;
            }

            const drawShape = (cx) => {
                // horizontal culling
                if (cx < -dotSize || cx > appWidth + dotSize) return;

                ctx.beginPath();
                if (d.type === 0) {
                    ctx.arc(cx, y, dotSize / 2, 0, Math.PI * 2);
                } else if (d.type === 1) {
                    const s = dotSize * 0.35;
                    ctx.rect(cx - s, y - s, s * 2, s * 2);
                } else if (d.type === 2) {
                    const r = dotSize / 2.2;
                    ctx.moveTo(cx + r * 0.866, y + r * 0.5);
                    ctx.lineTo(cx - r * 0.866, y + r * 0.5);
                    ctx.lineTo(cx, y - r);
                    ctx.closePath();
                }
                ctx.fill();

                if (!hideNonSelectedTracks) {
                    const isSelectedDot = selectedDot === d;
                    const isSelectedTrack = selectedTrack === track;
                    const isHoverDot = newHoverDot === d;

                    const forceOutline = AppState.getConeGenMode() && AppState.getConePointOutline();

                    if (isSelectedDot || isSelectedTrack || isHoverDot || forceOutline) {
                        if (isSelectedDot) ctx.strokeStyle = '#ff0000';
                        else if (isSelectedTrack) ctx.strokeStyle = '#ffff00';
                        else if (forceOutline) ctx.strokeStyle = AppState.getConeOutlineColor();
                        else ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                        
                        ctx.stroke();
                    }
                }
            };

            drawShape(x);
            drawShape(x - worldWidth);
            drawShape(x + worldWidth);
        }

        if (AppState.getConeGenMode()) {
            drawConeGenLabels(pointsToRender, worldWidth);
        }
    }

    function drawCone(viewWidth, viewHeight) {
        const selectedTrack = AppState.getSelectedTrack();
        if (!selectedTrack || selectedTrack.length < 2) return;

        const ctx = AppState.getCtx();
        const appWidth = AppState.WIDTH;
        const appHeight = AppState.HEIGHT;
        const topBound = appHeight - appWidth / 2;
        const panLocation = AppState.getPanLocation();
        const worldWidth = AppState.WIDTH * Utils.zoomMult();

        const growth = AppState.getConeGrowth();
        const opacity = AppState.getConeOpacity();
        const tint = AppState.getConeColor();
        
        // convert track to screen points
        const screenPoints = selectedTrack.map(d => {
            return {
                x: ((d.long - panLocation.long + 360) % 360) / viewWidth * appWidth,
                y: (panLocation.lat - d.lat) / viewHeight * appWidth / 2 + topBound
            };
        });

        const upperSide = []; const lowerSide = [];
        for (let i = 0; i < screenPoints.length; i++) {
            let r = (i / (screenPoints.length - 1)) * growth;
            let angle = ConeGen.getPerpAngle(screenPoints, i);
            upperSide.push({ x: screenPoints[i].x + Math.cos(angle - Math.PI / 2) * r, y: screenPoints[i].y + Math.sin(angle - Math.PI / 2) * r });
            lowerSide.push({ x: screenPoints[i].x + Math.cos(angle + Math.PI / 2) * r, y: screenPoints[i].y + Math.sin(angle + Math.PI / 2) * r });
        }

        const drawConePath = (ox) => {
            ctx.beginPath();
            ctx.fillStyle = ConeGen.hexToRgba(tint, opacity);
            ctx.moveTo(upperSide[0].x + ox, upperSide[0].y);
            for (let i = 0; i < upperSide.length - 1; i++) {
                const xc = (upperSide[i].x + upperSide[i+1].x) / 2 + ox;
                const yc = (upperSide[i].y + upperSide[i+1].y) / 2;
                ctx.quadraticCurveTo(upperSide[i].x + ox, upperSide[i].y, xc, yc);
            }
            const lastScreen = screenPoints[screenPoints.length-1];
            const lastUpper = upperSide[upperSide.length-1];
            ctx.lineTo(lastUpper.x + ox, lastUpper.y);
            
            const prevScreen = screenPoints[screenPoints.length-2] || lastScreen;
            const endAngle = Math.atan2(lastScreen.y - prevScreen.y, lastScreen.x - prevScreen.x);
            ctx.arc(lastScreen.x + ox, lastScreen.y, growth, endAngle - Math.PI/2, endAngle + Math.PI/2);
            
            ctx.lineTo(lowerSide[lowerSide.length-1].x + ox, lowerSide[lowerSide.length-1].y);
            for (let i = lowerSide.length - 1; i > 0; i--) {
                const xc = (lowerSide[i].x + lowerSide[i-1].x) / 2 + ox;
                const yc = (lowerSide[i].y + lowerSide[i-1].y) / 2;
                ctx.quadraticCurveTo(lowerSide[i].x + ox, lowerSide[i].y, xc, yc);
            }
            ctx.closePath();
            ctx.fill();
        };

        drawConePath(0);
        drawConePath(-worldWidth);
        drawConePath(worldWidth);
    }

    function drawConeGenLabels(pointsToRender, worldWidth) {
        const ctx = AppState.getCtx();
        
        const zoomBase = Math.pow(AppState.ZOOM_BASE, AppState.getZoomAmt());
        const dotSize = (2 * zoomBase) * AppState.getDotSizeMultiplier();
        
        const tSize = AppState.getConeTextSize();
        const fontFam = AppState.getConeFontFamily() === 'custom' ? AppState.getConeCustomFontName() : AppState.getConeFontFamily();
        const showMulti = AppState.getConeShowMultiUnit();
        const currentUnit = AppState.getConeUnit();

        ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
        
        const drawTextWithHalo = (text, x, y, size, weight = "600", alpha = 1) => {
            ctx.font = `${weight} ${size}px "${fontFam}", sans-serif`;
            ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.lineWidth = 4; ctx.strokeText(text, x, y);
            ctx.fillStyle = `rgba(255,255,255,${alpha})`; ctx.fillText(text, x, y);
        };

        pointsToRender.forEach(({x, y, d, track}) => {
            let typeStr = ImportExport.getTypeCode(d);
            
            let dateStr = "";
            if (d.date) {
                const month = d.date.substring(4, 6);
                const day = d.date.substring(6, 8);
                dateStr = `${month}/${day}`;
            }
            let timeStr = (d.time !== null && d.time !== undefined) ? String(d.time).padStart(2, '0') + "z" : "";
            
            let header = `${typeStr} ${dateStr} ${timeStr}`.trim();
            
            const drawLabelAt = (cx) => {
                if (cx < -200 || cx > AppState.WIDTH + 200) return;
                
                const labelXOffset = (dotSize / 2) + 8;
                drawTextWithHalo(header, cx + labelXOffset, y - (tSize/2), tSize, "600", 1);
                
                let windVal = ImportExport.getWindSpeed(d);
                let pressureVal = ImportExport.getPressure(d);
                let unitName = currentUnit.toUpperCase();
                let displayWind = ConeGen.convertWind(windVal, 'kt', currentUnit);
                
                let windLabel = `${displayWind} ${unitName}`;
                if (showMulti) {
                    let secondary = (currentUnit === 'mph') ? 'kph' : (currentUnit === 'kph' ? 'kt' : 'mph');
                    const secondaryVal = ConeGen.convertWind(windVal, 'kt', secondary);
                    windLabel += ` / ${secondaryVal} ${secondary.toUpperCase()}`;
                }
                let subLabel = `${windLabel}${pressureVal ? ' | ' + pressureVal + 'mb' : ''}`;
                drawTextWithHalo(subLabel, cx + labelXOffset, y + (tSize/2) + 2, tSize - 1, "500", 0.85);
            };

            drawLabelAt(x);
            drawLabelAt(x - worldWidth);
            drawLabelAt(x + worldWidth);
        });
    }

    function setZoomAbsolute(newZoomAmt, pivotX = AppState.WIDTH / 2, pivotY = (AppState.HEIGHT - AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO) + (AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO) / 2) {
        const oldViewW = Utils.mapViewWidth();
        const oldViewH = Utils.mapViewHeight();
        const clamped = Math.max(0, Math.min(15, newZoomAmt));

        const newViewW = 360 / Math.pow(AppState.ZOOM_BASE, clamped);
        const newViewH = 180 / Math.pow(AppState.ZOOM_BASE, clamped);

        const topBound = AppState.HEIGHT - AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO;
        const panLocation = AppState.getPanLocation();
        panLocation.long += (oldViewW - newViewW) * (pivotX / AppState.WIDTH);
        panLocation.lat -= (oldViewH - newViewH) * ((pivotY - topBound) / (AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO));

        panLocation.long = Utils.normalizeLongitude(panLocation.long);
        panLocation.lat = Utils.constrainLatitude(panLocation.lat, newViewH);

        AppState.setZoomAmt(clamped);
        AppState.setNeedsIndexRebuild(true); // Zoom changes screen coords -> Rebuild

        const zoomSliderEl = AppState.getZoomSliderEl();
        if (zoomSliderEl) zoomSliderEl.value = String(clamped);
        requestRedraw();
    }

    function setZoomRelative(delta, pivotX, pivotY) {
        setZoomAbsolute(AppState.getZoomAmt() + delta, pivotX, pivotY);
    }

    function createCoordinatesTab(container) {
        const coordTab = document.getElementById('coordinates-tab');
        if (!coordTab) return;
    }

    // zoom controls overlay
    function createZoomControls(container) {
        const wrap = document.getElementById('zoom-controls');
        const zoomOutBtnEl = document.getElementById('zoom-out-btn');
        const zoomInBtnEl = document.getElementById('zoom-in-btn');
        const zoomSliderEl = document.getElementById('zoom-slider');

        if (!wrap || !zoomOutBtnEl || !zoomInBtnEl || !zoomSliderEl) return;

        // update slider to current state
        zoomSliderEl.value = String(AppState.getZoomAmt());

        // store references in state
        AppState.setZoomInBtnEl(zoomInBtnEl);
        AppState.setZoomOutBtnEl(zoomOutBtnEl);
        AppState.setZoomSliderEl(zoomSliderEl);

        // promote canvas to its own layer
        const canvas = AppState.getCanvas();
        if (canvas) {
            canvas.style.willChange = 'transform';
            canvas.style.transform = 'translate3d(0,0,0)';
        }

        const pivotX = AppState.WIDTH / 2;
        const pivotY = (AppState.HEIGHT - AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO) + (AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO) / 2;

        zoomOutBtnEl.addEventListener('click', () => setZoomRelative(-0.5, pivotX, pivotY), { passive: true });
        zoomInBtnEl.addEventListener('click', () => setZoomRelative(0.5, pivotX, pivotY), { passive: true });
        zoomSliderEl.addEventListener('input', () => setZoomAbsolute(parseFloat(zoomSliderEl.value), pivotX, pivotY), { passive: true });

        // toggle acceleration during manual UI zoom interactions
        let accTimeout;
        const startZoomUI = () => {
            clearTimeout(accTimeout);
            Utils.setHardwareAcceleration(true);
        };
        const stopZoomUI = () => {
            clearTimeout(accTimeout);
            accTimeout = setTimeout(() => Utils.setHardwareAcceleration(false), 500);
        };

        [zoomOutBtnEl, zoomInBtnEl, zoomSliderEl].forEach(el => {
            el.addEventListener('mousedown', startZoomUI, { passive: true });
            el.addEventListener('touchstart', startZoomUI, { passive: true });
            el.addEventListener('mouseup', stopZoomUI, { passive: true });
            el.addEventListener('touchend', stopZoomUI, { passive: true });
        });
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