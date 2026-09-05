// Rendering and drawing operations

const Renderer = (() => {
    const LOCAL_MAPS_KEY = 'hypo-track-local-custom-maps';

    // reusable path and line segment buffers
    const normalLineSegments = [];
    const selectedLineSegments = [];

    // reusable buffers for cone geometry
    const coneScreenPoints = [];
    const coneUpperSide = [];
    const coneLowerSide = [];

    let lastRenderPanLong = null;
    let lastRenderPanLat = null;
    let lastRenderZoom = null;

    const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

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

        let worker = null;
        try {
            worker = new Worker('./js/worker.js');
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
            AppState.setLoadedMapImg(true);
        } catch (error) {
            console.error('Image loading failed:', error);
            AppState.setMapImgs({});
            throw error;
        } finally {
            if (worker) worker.terminate();
        }
    }

    function draw() {
        AppState.setIsRedrawScheduled(false);
        if (!AppState.getNeedsRedraw()) return;
        AppState.setNeedsRedraw(false);

        const ctx = AppState.getCtx();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
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

    function drawSection(ctx, img, mw, me, mn, ms, qw, qe, qn, qs, mapWidth, mapHeight, mapLeft, mapTop, west, north, south, mvw, offset = 0) {
        const rangeW = me - mw;
        const rangeH = ms - mn;

        let sx = img.width * clamp01((qw - mw - offset) / rangeW);
        let sw = img.width * clamp01((qe - mw - offset) / rangeW) - sx;
        let sy = img.height * clamp01((qn - mn) / rangeH);
        let sh = img.height * clamp01((qs - mn) / rangeH) - sy;

        sw = Math.max(1, sw);
        sh = Math.max(1, sh);

        let dx = mapWidth * (qw - west) / mvw + mapLeft;
        let dw = mapWidth * (qe - qw) / mvw;
        let dy = mapHeight * (qn - north) / (south - north) + mapTop;
        let dh = mapHeight * (qs - qn) / (south - north);

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

        sw = Math.min(sw, img.width - sx);
        sh = Math.min(sh, img.height - sy);

        if (sw > 0 && sh > 0 && rDx + rDw > mapLeft && rDx < mapLeft + mapWidth && sx < img.width && sy < img.height) {
            ctx.drawImage(img, sx, sy, sw, sh, rDx, rDy, rDw, rDh);
        } else {
            ctx.fillStyle = "#efefef";
            ctx.fillRect(rDx, rDy, rDw, rDh);
        }
    }

    function drawMap(mvw, mvh) {
        const ctx = AppState.getCtx();
        const panLocation = AppState.getPanLocation();
        const mapRect = Utils.getMapRenderRect();
        const mapLeft = mapRect.left;
        const mapTop = mapRect.top;
        const mapWidth = mapRect.width;
        const mapHeight = mapRect.height;

        if (!mvw) mvw = Utils.mapViewWidth();
        if (!mvh) mvh = Utils.mapViewHeight();

        const west = panLocation.long;
        const north = panLocation.lat;
        const south = north - mvh;

        const customMapImg = AppState.getCustomMapImg();
        if (AppState.getUseCustomMap() && customMapImg) {
            const mapNorth = 90;
            const mapSouth = -90;
            const sy = customMapImg.height * (mapNorth - north) / (mapNorth - mapSouth);
            const sh = customMapImg.height * mvh / (mapNorth - mapSouth);
            const sx = customMapImg.width * (west + 180) / 360;
            const sw = customMapImg.width * mvw / 360;
            const dy = mapTop;
            const dh = mapHeight;

            if (sx + sw > customMapImg.width) {
                const sw1 = customMapImg.width - sx;
                const dw1 = mapWidth * (sw1 / sw);
                ctx.drawImage(customMapImg, sx, sy, sw1, sh, mapLeft, dy, dw1, dh);
                ctx.drawImage(customMapImg, 0, sy, sw - sw1, sh, mapLeft + dw1, dy, mapWidth - dw1, dh);
            } else {
                ctx.drawImage(customMapImg, sx, sy, sw, sh, mapLeft, dy, mapWidth, dh);
            }
        } else {
            const mapImgs = AppState.getMapImgs();
            const east = west + mvw;
            const minNorthZero = Math.min(north, 0);
            const maxSouthZero = Math.max(south, 0);

            if (west < 0) {
                if (north > 0) drawSection(ctx, mapImgs.nw, -180, 0, 90, 0, west, Math.min(east, 0), north, maxSouthZero, mapWidth, mapHeight, mapLeft, mapTop, west, north, south, mvw);
                if (south < 0) drawSection(ctx, mapImgs.sw, -180, 0, 0, -90, west, Math.min(east, 0), minNorthZero, south, mapWidth, mapHeight, mapLeft, mapTop, west, north, south, mvw);
            }
            if (east > 0) {
                const maxWestZero = Math.max(west, 0);
                if (north > 0) drawSection(ctx, mapImgs.ne, 0, 180, 90, 0, maxWestZero, Math.min(east, 180), north, maxSouthZero, mapWidth, mapHeight, mapLeft, mapTop, west, north, south, mvw);
                if (south < 0) drawSection(ctx, mapImgs.se, 0, 180, 0, -90, maxWestZero, Math.min(east, 180), minNorthZero, south, mapWidth, mapHeight, mapLeft, mapTop, west, north, south, mvw);
            }
            if (east > 180) {
                if (north > 0) drawSection(ctx, mapImgs.nw, -180, 0, 90, 0, 180, Math.min(east, 360), north, maxSouthZero, mapWidth, mapHeight, mapLeft, mapTop, west, north, south, mvw, 360);
                if (south < 0) drawSection(ctx, mapImgs.sw, -180, 0, 0, -90, 180, Math.min(east, 360), minNorthZero, south, mapWidth, mapHeight, mapLeft, mapTop, west, north, south, mvw, 360);
            }
            if (east > 360) {
                if (north > 0) drawSection(ctx, mapImgs.ne, 0, 180, 90, 0, 360, east, north, maxSouthZero, mapWidth, mapHeight, mapLeft, mapTop, west, north, south, mvw, 360);
                if (south < 0) drawSection(ctx, mapImgs.se, 0, 180, 0, -90, 360, east, minNorthZero, south, mapWidth, mapHeight, mapLeft, mapTop, west, north, south, mvw, 360);
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
        const mapRect = Utils.getMapRenderRect();
        const worldWidth = mapRect.width * Utils.zoomMult();
        const scaleX = mapRect.width / viewWidth;
        const scaleY = mapRect.height / viewHeight;
        const panLong = panLocation.long;
        const panLat = panLocation.lat;

        const leftBound = mapRect.left;
        const rightBound = mapRect.left + mapRect.width;
        const topBound = mapRect.top;
        const bottomBound = mapRect.top + mapRect.height;

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            for (let j = 0; j < track.length; j++) {
                const point = track[j];
                const x = ((point.long - panLong + 360) % 360) * scaleX + leftBound;
                const y = (panLat - point.lat) * scaleY + topBound;
                const inBounds = x >= leftBound && x < rightBound && y >= topBound && y < bottomBound;

                if (inBounds) {
                    spatialIndex.insert({ screenX: x, screenY: y, point, track });
                }

                const leftX = x - worldWidth;
                if (leftX > leftBound - 100 && leftX < rightBound + 100) spatialIndex.insert({ screenX: leftX, screenY: y, point, track });

                const rightX = x + worldWidth;
                if (rightX > leftBound - 100 && rightX < rightBound + 100) spatialIndex.insert({ screenX: rightX, screenY: y, point, track });
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
        const mapRect = Utils.getMapRenderRect();
        const worldWidth = mapRect.width * Utils.zoomMult();
        const panLocation = AppState.getPanLocation();
        const panLong = panLocation.long;
        const panLat = panLocation.lat;
        const tracks = AppState.getTracks();
        const hideNonSelectedTracks = AppState.getHideNonSelectedTracks();
        const selectedTrack = AppState.getSelectedTrack();
        const selectedDot = AppState.getSelectedDot();
        const masterCategories = AppState.getMasterCategories();
        const useAltColors = AppState.getUseAltColors();
        const leftBound = mapRect.left;
        const rightBound = mapRect.left + mapRect.width;
        const topBound = mapRect.top;
        const bottomBound = mapRect.top + mapRect.height;

        const scaleX = mapRect.width / viewWidth;
        const scaleY = mapRect.height / viewHeight;

        // hover hit testing constants
        const mouseX = canvas.mouseX;
        const mouseY = canvas.mouseY;
        const hasMouse = mouseX !== undefined && mouseY !== undefined;
        let newHoverDot = undefined;
        let newHoverTrack = undefined;
        const hoverThreshSq = (zoomBase * zoomBase);

        ctx.lineWidth = baseDotSize / 9;

        normalLineSegments.length = 0;
        selectedLineSegments.length = 0;

        // line segments and hover pass
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            if (hideNonSelectedTracks && selectedTrack !== track) continue;

            const isSelected = selectedTrack === track && !hideNonSelectedTracks;
            const segments = isSelected ? selectedLineSegments : normalLineSegments;

            let prevX = null, prevY = null;

            for (let j = 0; j < track.length; j++) {
                const d = track[j];
                const x = ((d.long - panLong + 360) % 360) * scaleX + leftBound;
                const y = (panLat - d.lat) * scaleY + topBound;

                // line segments logic
                if (prevX !== null) {
                    let x0 = prevX, x1 = x;
                    if (x1 - x0 > worldWidth / 2) x1 -= worldWidth;
                    else if (x1 - x0 < -worldWidth / 2) x1 += worldWidth;
                    segments.push(x0, prevY, x1, y);
                }
                prevX = x;
                prevY = y;

                // hover logic
                if (hasMouse) {
                    let distSq = (x - mouseX) ** 2 + (y - mouseY) ** 2;
                    if (distSq < hoverThreshSq) {
                        newHoverDot = d;
                        newHoverTrack = track;
                    } else {
                        // check wrapped points if main didn't hit
                        const leftX = x - worldWidth;
                        distSq = (leftX - mouseX) ** 2 + (y - mouseY) ** 2;
                        if (distSq < hoverThreshSq) {
                            newHoverDot = d;
                            newHoverTrack = track;
                        } else {
                            const rightX = x + worldWidth;
                            distSq = (rightX - mouseX) ** 2 + (y - mouseY) ** 2;
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
        if (normalLineSegments.length > 0) {
            ctx.strokeStyle = '#ffffff';
            ctx.beginPath();
            for (let i = 0; i < normalLineSegments.length; i += 4) {
                const x0 = normalLineSegments[i], y0 = normalLineSegments[i + 1];
                const x1 = normalLineSegments[i + 2], y1 = normalLineSegments[i + 3];
                ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
                ctx.moveTo(x0 - worldWidth, y0); ctx.lineTo(x1 - worldWidth, y1);
                ctx.moveTo(x0 + worldWidth, y0); ctx.lineTo(x1 + worldWidth, y1);
            }
            ctx.stroke();
        }

        if (selectedLineSegments.length > 0) {
            ctx.strokeStyle = '#ffff00';
            ctx.beginPath();
            for (let i = 0; i < selectedLineSegments.length; i += 4) {
                const x0 = selectedLineSegments[i], y0 = selectedLineSegments[i + 1];
                const x1 = selectedLineSegments[i + 2], y1 = selectedLineSegments[i + 3];
                ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
                ctx.moveTo(x0 - worldWidth, y0); ctx.lineTo(x1 - worldWidth, y1);
                ctx.moveTo(x0 + worldWidth, y0); ctx.lineTo(x1 + worldWidth, y1);
            }
            ctx.stroke();
        }

        // rendering points
        const yMin = topBound - dotSize / 2;
        const yMax = bottomBound + dotSize / 2;
        let lastFillStyle = null;

        const forceOutline = AppState.getConeGenMode() && AppState.getConePointOutline();
        const coneOutlineColor = AppState.getConeOutlineColor();

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            if (hideNonSelectedTracks && selectedTrack !== track) continue;

            const isSelectedTrack = selectedTrack === track;

            for (let j = 0; j < track.length; j++) {
                const d = track[j];
                const y = (panLat - d.lat) * scaleY + topBound;

                // viewport culling
                if (y < yMin || y > yMax) continue;

                const x = ((d.long - panLong + 360) % 360) * scaleX + leftBound;

                // color calculation
                const category = masterCategories[d.cat];
                const fillStyle = category ? (useAltColors ? category.altColor : category.color) : '#000000';

                // only switch context color if it changed from the previous point
                if (fillStyle !== lastFillStyle) {
                    ctx.fillStyle = fillStyle;
                    lastFillStyle = fillStyle;
                }

                drawPointShape(ctx, d, track, x, y, dotSize, leftBound, rightBound, hideNonSelectedTracks, selectedDot, isSelectedTrack, newHoverDot, forceOutline, coneOutlineColor);
                drawPointShape(ctx, d, track, x - worldWidth, y, dotSize, leftBound, rightBound, hideNonSelectedTracks, selectedDot, isSelectedTrack, newHoverDot, forceOutline, coneOutlineColor);
                drawPointShape(ctx, d, track, x + worldWidth, y, dotSize, leftBound, rightBound, hideNonSelectedTracks, selectedDot, isSelectedTrack, newHoverDot, forceOutline, coneOutlineColor);
            }
        }

        if (AppState.getConeGenMode()) {
            drawConeGenLabels(viewWidth, viewHeight, worldWidth);
        }
    }

    function drawPointShape(ctx, d, track, cx, y, dotSize, leftBound, rightBound, hideNonSelectedTracks, selectedDot, isSelectedTrack, newHoverDot, forceOutline, coneOutlineColor) {
        // horizontal culling
        if (cx < leftBound - dotSize || cx > rightBound + dotSize) return;

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
            const isHoverDot = newHoverDot === d;

            if (isSelectedDot || isSelectedTrack || isHoverDot || forceOutline) {
                if (isSelectedDot) ctx.strokeStyle = '#ff0000';
                else if (isSelectedTrack) ctx.strokeStyle = '#ffff00';
                else if (forceOutline) ctx.strokeStyle = coneOutlineColor;
                else ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                
                ctx.stroke();
            }
        }
    }

    function drawCone(viewWidth, viewHeight) {
        const selectedTrack = AppState.getSelectedTrack();
        if (!selectedTrack || selectedTrack.length < 2) return;

        const ctx = AppState.getCtx();
        const mapRect = Utils.getMapRenderRect();
        const topBound = mapRect.top;
        const panLocation = AppState.getPanLocation();
        const worldWidth = mapRect.width * Utils.zoomMult();

        const growth = AppState.getConeGrowth();
        const opacity = AppState.getConeOpacity();
        const tint = AppState.getConeColor();
        
        const scaleX = mapRect.width / viewWidth;
        const scaleY = mapRect.height / viewHeight;
        const panLong = panLocation.long;
        const panLat = panLocation.lat;
        const leftBound = mapRect.left;

        const len = selectedTrack.length;
        coneScreenPoints.length = len;
        coneUpperSide.length = len;
        coneLowerSide.length = len;

        // convert track to screen points
        for (let i = 0; i < len; i++) {
            const d = selectedTrack[i];
            coneScreenPoints[i] = {
                x: ((d.long - panLong + 360) % 360) * scaleX + leftBound,
                y: (panLat - d.lat) * scaleY + topBound
            };
        }

        const invLen = 1 / (len - 1);
        for (let i = 0; i < len; i++) {
            let r = (i * invLen) * growth;
            let angle = ConeGen.getPerpAngle(coneScreenPoints, i);
            const cosAngle = Math.cos(angle - Math.PI / 2) * r;
            const sinAngle = Math.sin(angle - Math.PI / 2) * r;
            coneUpperSide[i] = { x: coneScreenPoints[i].x + cosAngle, y: coneScreenPoints[i].y + sinAngle };
            coneLowerSide[i] = { x: coneScreenPoints[i].x - cosAngle, y: coneScreenPoints[i].y - sinAngle };
        }

        ctx.fillStyle = ConeGen.hexToRgba(tint, opacity);
        renderConePath(ctx, 0, len, growth, worldWidth);
        renderConePath(ctx, -worldWidth, len, growth, worldWidth);
        renderConePath(ctx, worldWidth, len, growth, worldWidth);
    }

    function renderConePath(ctx, ox, len, growth) {
        ctx.beginPath();
        ctx.moveTo(coneUpperSide[0].x + ox, coneUpperSide[0].y);
        for (let i = 0; i < len - 1; i++) {
            const xc = (coneUpperSide[i].x + coneUpperSide[i + 1].x) / 2 + ox;
            const yc = (coneUpperSide[i].y + coneUpperSide[i + 1].y) / 2;
            ctx.quadraticCurveTo(coneUpperSide[i].x + ox, coneUpperSide[i].y, xc, yc);
        }
        const lastScreen = coneScreenPoints[len - 1];
        const lastUpper = coneUpperSide[len - 1];
        ctx.lineTo(lastUpper.x + ox, lastUpper.y);
        
        const prevScreen = coneScreenPoints[len - 2] || lastScreen;
        const endAngle = Math.atan2(lastScreen.y - prevScreen.y, lastScreen.x - prevScreen.x);
        ctx.arc(lastScreen.x + ox, lastScreen.y, growth, endAngle - Math.PI / 2, endAngle + Math.PI / 2);
        
        ctx.lineTo(coneLowerSide[len - 1].x + ox, coneLowerSide[len - 1].y);
        for (let i = len - 1; i > 0; i--) {
            const xc = (coneLowerSide[i].x + coneLowerSide[i - 1].x) / 2 + ox;
            const yc = (coneLowerSide[i].y + coneLowerSide[i - 1].y) / 2;
            ctx.quadraticCurveTo(coneLowerSide[i].x + ox, coneLowerSide[i].y, xc, yc);
        }
        ctx.closePath();
        ctx.fill();
    }

    function drawConeGenLabels(viewWidth, viewHeight, worldWidth) {
        const ctx = AppState.getCtx();
        const mapRect = Utils.getMapRenderRect();
        const topBound = mapRect.top;
        const leftBound = mapRect.left;
        const panLocation = AppState.getPanLocation();
        const panLong = panLocation.long;
        const panLat = panLocation.lat;
        const scaleX = mapRect.width / viewWidth;
        const scaleY = mapRect.height / viewHeight;
        
        const zoomBase = Math.pow(AppState.ZOOM_BASE, AppState.getZoomAmt());
        const dotSize = (2 * zoomBase) * AppState.getDotSizeMultiplier();
        
        const tSize = AppState.getConeTextSize();
        const fontFam = AppState.getConeFontFamily() === 'custom' ? AppState.getConeCustomFontName() : AppState.getConeFontFamily();
        const showMulti = AppState.getConeShowMultiUnit();
        const currentUnit = AppState.getConeUnit();

        ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(0,0,0,0.8)";

        const headerFont = `600 ${tSize}px "${fontFam}", sans-serif`;
        const subFont = `500 ${tSize - 1}px "${fontFam}", sans-serif`;
        const labelXOffset = (dotSize / 2) + 8;

        const tracks = AppState.getTracks();
        const hideNonSelectedTracks = AppState.getHideNonSelectedTracks();
        const selectedTrack = AppState.getSelectedTrack();

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            if (hideNonSelectedTracks && selectedTrack !== track) continue;

            for (let j = 0; j < track.length; j++) {
                const d = track[j];
                const x = ((d.long - panLong + 360) % 360) * scaleX + leftBound;
                const y = (panLat - d.lat) * scaleY + topBound;

                let typeStr = ImportExport.getTypeCode(d);
                let dateStr = "";
                if (d.date) {
                    const month = d.date.substring(4, 6);
                    const day = d.date.substring(6, 8);
                    dateStr = `${month}/${day}`;
                }
                let timeStr = (d.time !== null && d.time !== undefined) ? String(d.time).padStart(2, '0') + "z" : "";
                let header = `${typeStr} ${dateStr} ${timeStr}`.trim();

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

                renderSingleConeLabel(ctx, header, subLabel, x, y, labelXOffset, tSize, mapRect, headerFont, subFont);
                renderSingleConeLabel(ctx, header, subLabel, x - worldWidth, y, labelXOffset, tSize, mapRect, headerFont, subFont);
                renderSingleConeLabel(ctx, header, subLabel, x + worldWidth, y, labelXOffset, tSize, mapRect, headerFont, subFont);
            }
        }
    }

    function renderSingleConeLabel(ctx, header, subLabel, cx, y, labelXOffset, tSize, mapRect, headerFont, subFont) {
        if (cx < mapRect.left - 200 || cx > mapRect.left + mapRect.width + 200) return;
        
        const lx = cx + labelXOffset;
        const topY = y - (tSize / 2);
        const botY = y + (tSize / 2) + 2;

        ctx.font = headerFont;
        ctx.strokeText(header, lx, topY);
        ctx.fillStyle = "rgba(255,255,255,1)";
        ctx.fillText(header, lx, topY);

        ctx.font = subFont;
        ctx.strokeText(subLabel, lx, botY);
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillText(subLabel, lx, botY);
    }

    function setZoomAbsolute(newZoomAmt, pivotX = AppState.WIDTH / 2, pivotY = (AppState.HEIGHT - AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO) + (AppState.WIDTH * AppState.VIEW_HEIGHT_RATIO) / 2) {
        const oldViewW = Utils.mapViewWidth();
        const oldViewH = Utils.mapViewHeight();
        const clamped = Math.max(0, Math.min(15, newZoomAmt));

        const newViewW = 360 / Math.pow(AppState.ZOOM_BASE, clamped);
        const newViewH = 180 / Math.pow(AppState.ZOOM_BASE, clamped);

        const mapRect = Utils.getMapRenderRect();
        const panLocation = AppState.getPanLocation();
        panLocation.long += (oldViewW - newViewW) * ((pivotX - mapRect.left) / mapRect.width);
        panLocation.lat -= (oldViewH - newViewH) * ((pivotY - mapRect.top) / mapRect.height);

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

        const mapRect = Utils.getMapRenderRect();
        const pivotX = mapRect.left + mapRect.width / 2;
        const pivotY = mapRect.top + mapRect.height / 2;

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