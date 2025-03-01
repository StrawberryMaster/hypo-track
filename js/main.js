var HypoTrack = (function () {
    const TITLE = 'HypoTrack';
    const VERSION = '0.2.2';
    const IDB_KEY = 'hypo-track';

    const WIDTH = 1000;
    const HEIGHT = 500;
    const COLORS_ALT = ['#6ec1ea', '#4dffff', '#ffffd9', '#ffd98c', '#ff9e59', '#ff738a', '#a188fc', '#c0c0c0'];
    const COLORS = ['#5ebaff', '#00faf4', '#ffffcc', '#ffe775', '#ffc140', '#ff8f20', '#ff6060', '#c0c0c0'];

    let loadedMapImg,
        mapImgs,
        // mapBuffer,
        panLocation,
        zoomAmt,
        beginClickX,
        beginClickY,
        beginPanX,
        beginPanY,
        beginPointMoveLong,
        beginPointMoveLat,
        mouseMode,
        tracks,
        categoryToPlace,
        typeToPlace,
        hoverDot,
        hoverTrack,
        selectedDot,
        selectedTrack,
        hideNonSelectedTracks,
        deleteTrackPoints,
        useAltColors,
        useSmallDots,
        saveName,
        autosave,
        saveLoadReady;

    let refreshGUI; // hoist function

    // container for functions to be made global for p5.js
    let _p5 = {};

    _p5.setup = function () {
        versionManager.setVersion(TITLE + ' v', VERSION);
        document.title = TITLE;

        let canvas = createCanvas(WIDTH, HEIGHT);
        canvas.parent('canvas-container');
        // mapBuffer = createGraphics(WIDTH, HEIGHT);

        zoomAmt = 0;
        panLocation = {
            long: -180,
            lat: 90
        };
        loadedMapImg = false;
        tracks = [];
        categoryToPlace = 0;
        typeToPlace = 0;
        useAltColors = false;
        useSmallDots = false;
        autosave = true;
        saveLoadReady = true;

        mapImgs = {};

        loadImages().then(() => {
            loadedMapImg = true;
            // updateMapBuffer();
        });

        //loadImg('resources/map_regular.jpg').then(img => {
        //    mapImgs.regular = img;
        //    loadedMapImg = true;
        //});
    };

    let worker;
    async function loadImages() {
        const IMAGE_PATHS = new Map([
            ['nw', '../resources/map_hi-res_NW.webp'],
            ['ne', '../resources/map_hi-res_NE.webp'],
            ['sw', '../resources/map_hi-res_SW.webp'],
            ['se', '../resources/map_hi-res_SE.webp']
        ]);

        const createP5Image = (arrayBuffer) =>
            new Promise((resolve, reject) => {
                const url = URL.createObjectURL(new Blob([arrayBuffer]));
                loadImage(url,
                    img => {
                        URL.revokeObjectURL(url);
                        resolve(img);
                    },
                    err => reject(new Error(`Image load failed: ${err}`))
                );
            });

        try {
            const worker = new Worker('js/worker.js');

            const arrayBuffers = await new Promise((resolve, reject) => {
                worker.onmessage = e => e.data.error ? reject(e.data.error) : resolve(e.data.imgs);
                worker.onerror = e => reject(e);
                worker.postMessage({ paths: Array.from(IMAGE_PATHS.values()) });
            });

            const imagePromises = Array.from(IMAGE_PATHS.keys()).map((key, index) =>
                createP5Image(arrayBuffers[index]).then(img => [key, img])
            );

            const imageEntries = await Promise.all(imagePromises);
            Object.assign(mapImgs, Object.fromEntries(imageEntries));

            return Promise.resolve();

        } catch (error) {
            console.error('Image loading failed:', error);
            mapImgs = {};
            throw error;
        } finally {
            worker?.terminate();
        }
    }

    _p5.draw = function () {
        background(255);
        fill(0);
        noStroke();
        if (loadedMapImg) {
            // image(mapBuffer, 0, 0);
            drawMap();
            let dotSize = 2 * pow(1.25, zoomAmt);
            strokeWeight(dotSize / 9);
            if (useSmallDots)
                dotSize *= 9 / 15;

            const worldWidth = WIDTH * zoomMult();

            // our pool of reusable objects
            let coordsPool = [];
            let poolIndex = 0;

            function getCoords() {
                if (poolIndex >= coordsPool.length) {
                    coordsPool.push({ x: 0, y: 0, inBounds: false });
                }
                return coordsPool[poolIndex++];
            }

            function longLatToScreenCoordsPooled(d, out) {
                let long = d.long;
                let lat = d.lat;
                out.x = ((long - panLocation.long + 360) % 360) / mapViewWidth() * WIDTH;
                out.y = (panLocation.lat - lat) / mapViewHeight() * WIDTH / 2 + HEIGHT - WIDTH / 2;
                out.inBounds = out.x >= 0 && out.x < WIDTH && out.y >= (HEIGHT - WIDTH / 2) && out.y < HEIGHT;
            }

            hoverTrack = undefined;
            hoverDot = undefined;

            // first pass: draw tracks and points
            for (let i = 0; i < tracks.length; i++) {
                if (!hideNonSelectedTracks || selectedTrack === tracks[i]) {
                    for (let j = 0; j < tracks[i].length; j++) {
                        let d = tracks[i][j];

                        let coords = getCoords();
                        longLatToScreenCoordsPooled(d, coords);

                        if (j < tracks[i].length - 1) {
                            let d1 = tracks[i][j + 1];
                            let coords1 = getCoords();
                            longLatToScreenCoordsPooled(d1, coords1);

                            noFill();
                            if (selectedTrack === tracks[i] && !hideNonSelectedTracks)
                                stroke('#ffff00');
                            else
                                stroke('#ffffff');
                            let x0 = coords.x;
                            let x1 = coords1.x;
                            if (x1 - x0 > worldWidth / 2)
                                x1 -= worldWidth;
                            else if (x1 - x0 < -worldWidth / 2)
                                x1 += worldWidth;
                            line(x0, coords.y, x1, coords1.y);
                            line(x0 - worldWidth, coords.y, x1 - worldWidth, coords1.y);
                            line(x0 + worldWidth, coords.y, x1 + worldWidth, coords1.y);
                        }

                        if (useAltColors)
                            fill(COLORS_ALT[d.cat]);
                        else
                            fill(COLORS[d.cat]);
                        if (hideNonSelectedTracks)
                            noStroke();
                        else if (selectedDot === d)
                            stroke('#ff0000');
                        else if (hoverDot === d)
                            stroke('#ff00ff');
                        else if (selectedTrack === tracks[i])
                            stroke('#ffff00');
                        else if (hoverTrack === tracks[i])
                            stroke('#ffffff');
                        else
                            noStroke();

                        function mark(x) {
                            if (
                                x >= -dotSize / 2 &&
                                x < WIDTH + dotSize / 2 &&
                                coords.y >= (HEIGHT - WIDTH / 2) - dotSize / 2 &&
                                coords.y < HEIGHT + dotSize / 2
                            ) {
                                if (d.type === 0)
                                    ellipse(x, coords.y, dotSize, dotSize);
                                else if (d.type === 1)
                                    rect(
                                        x - dotSize * 0.35,
                                        coords.y - dotSize * 0.35,
                                        dotSize * 0.7,
                                        dotSize * 0.7
                                    );
                                else if (d.type === 2)
                                    triangle(
                                        x + dotSize / 2.2 * cos(PI / 6),
                                        coords.y + dotSize / 2.2 * sin(PI / 6),
                                        x + dotSize / 2.2 * cos((5 * PI) / 6),
                                        coords.y + dotSize / 2.2 * sin((5 * PI) / 6),
                                        x + dotSize / 2.2 * cos((3 * PI) / 2),
                                        coords.y + dotSize / 2.2 * sin((3 * PI) / 2)
                                    );
                            }
                        }

                        mark(coords.x);
                        mark(coords.x - worldWidth);
                        mark(coords.x + worldWidth);
                    }
                }
            }

            // reset pool for future reuse
            poolIndex = 0;

            // second pass: determine hover state
            for (let i = tracks.length - 1; i >= 0; i--) {
                if (!hideNonSelectedTracks || selectedTrack === tracks[i]) {
                    for (let j = tracks[i].length - 1; j >= 0; j--) {
                        let d = tracks[i][j];
                        let c = getCoords();
                        longLatToScreenCoordsPooled(d, c);
                        if (
                            c.inBounds &&
                            sqrt(sq(c.x - mouseX) + sq(c.y - mouseY)) < pow(1.25, zoomAmt)
                        ) {
                            hoverDot = d;
                            hoverTrack = tracks[i];
                            return;
                        }
                    }
                }
            }
        } else {
            textSize(48);
            textAlign(CENTER, CENTER);
            text('Loading...', WIDTH / 2, HEIGHT / 2);
        }
    };

    function /* updateMapBuffer */drawMap() {
        // mapBuffer.clear();

        const topBound = HEIGHT - WIDTH / 2;
        const mvw = mapViewWidth();
        const mvh = mapViewHeight();
        const west = panLocation.long;
        const east = west + mvw;
        const north = panLocation.lat;
        const south = north - mvh;

        const coords = {
            sx: 0, sy: 0, sw: 0, sh: 0,
            dx: 0, dy: 0, dw: 0, dh: 0
        };

        const drawSection = (img, mw, me, mn, ms, qw, qe, qn, qs) => {
            const { width, height } = img;

            coords.sx = width * (qw - mw) / (me - mw);
            coords.sy = height * (qn - mn) / (ms - mn);
            coords.sw = width * (qe - qw) / (me - mw);
            coords.sh = height * (qs - qn) / (ms - mn);

            coords.dx = WIDTH * (qw - west) / mvw;
            coords.dy = (HEIGHT - topBound) * (qn - north) / (south - north) + topBound;
            coords.dw = WIDTH * (qe - qw) / mvw;
            coords.dh = (HEIGHT - topBound) * (qs - qn) / (south - north);

            image(img,
                coords.dx, coords.dy, coords.dw, coords.dh,
                coords.sx, coords.sy, coords.sw, coords.sh
            );
        };

        const northGtZero = north > 0;
        const southLtZero = south < 0;
        const minNorthZero = min(north, 0);
        const maxSouthZero = max(south, 0);

        // Draw sections based on view bounds
        if (west < 0) {
            if (northGtZero)
                drawSection(mapImgs.nw, -180, 0, 90, 0, west, min(east, 0), north, maxSouthZero);
            if (southLtZero)
                drawSection(mapImgs.sw, -180, 0, 0, -90, west, min(east, 0), minNorthZero, south);
        }
        if (east > 0) {
            const maxWestZero = max(west, 0);
            if (northGtZero)
                drawSection(mapImgs.ne, 0, 180, 90, 0, maxWestZero, min(east, 180), north, maxSouthZero);
            if (southLtZero)
                drawSection(mapImgs.se, 0, 180, 0, -90, maxWestZero, min(east, 180), minNorthZero, south);
        }
        if (east > 180) {
            if (northGtZero)
                drawSection(mapImgs.nw, 180, 360, 90, 0, 180, min(east, 360), north, maxSouthZero);
            if (southLtZero)
                drawSection(mapImgs.sw, 180, 360, 0, -90, 180, min(east, 360), minNorthZero, south);
        }
        if (east > 360) {
            if (northGtZero)
                drawSection(mapImgs.ne, 360, 540, 90, 0, 360, east, north, maxSouthZero);
            if (southLtZero)
                drawSection(mapImgs.se, 360, 540, 0, -90, 360, east, minNorthZero, south);
        }
    }

    // Database //

    let Database = (() => {
        let db = new Dexie(IDB_KEY);
        db.version(1).stores({ saves: '' });

        let lastSave = 0;
        const SAVE_DELAY = 2000;

        const withLock = async (operation) => {
            if (!saveLoadReady) return;
            saveLoadReady = false;
            try {
                await operation();
            } catch (error) {
                console.error(`Jinkies. An error occurred: ${error.message}`);
                throw error;
            } finally {
                saveLoadReady = true;
                refreshGUI();
            }
        };

        const getKey = () => saveName || 'Autosave';

        async function save() {
            const now = performance.now();
            if (now - lastSave < SAVE_DELAY) return;
            lastSave = now;

            await withLock(async () => {
                await db.saves.put(tracks, getKey());
            });
        }

        async function load() {
            await withLock(async () => {
                tracks = await db.saves.get(getKey()) || [];
                tracks.forEach(track => {
                    track.forEach((point, i) => {
                        track[i] = Object.assign(Object.create(TrackPoint.prototype), point);
                    });
                });
            });
        }

        async function list() {
            return await db.saves.toCollection().primaryKeys();
        }

        async function delete_() {
            await withLock(async () => {
                await db.saves.delete(getKey());
            });
        }

        return { save, load, list, delete: delete_ };
    })();

    // Undo/Redo History //

    const History = (() => {
        let undoItems = [];
        let redoItems = [];

        const ActionTypes = {
            addPoint: 0,
            movePoint: 1,
            modifyPoint: 2,
            deletePoint: 3
        };

        function undo() {
            if (canUndo()) {
                const action = undoItems.pop();
                const t = action.actionType;
                const d = action.data;

                if (t === ActionTypes.addPoint) {
                    const track = tracks[d.trackIndex];
                    const point = track[d.pointIndex];
                    track.splice(d.pointIndex, 1);
                    if (point === selectedDot && track.length > 0)
                        selectedDot = track[track.length - 1];
                    if (track.length < 1) {
                        tracks.splice(d.trackIndex, 1);
                        if (track === selectedTrack)
                            deselectTrack();
                    }
                } else if (t === ActionTypes.movePoint) {
                    const point = tracks[d.trackIndex][d.pointIndex];
                    point.long = d.long0;
                    point.lat = d.lat0;
                } else if (t === ActionTypes.modifyPoint) {
                    const point = tracks[d.trackIndex][d.pointIndex];
                    point.cat = d.oldCat;
                    point.type = d.oldType;
                } else if (t === ActionTypes.deletePoint) {
                    let track;
                    if (d.trackDeleted) {
                        track = [];
                        tracks.splice(d.trackIndex, 0, track);
                    } else
                        track = tracks[d.trackIndex];
                    const point = new TrackPoint(d.long, d.lat, d.cat, d.type);
                    track.splice(d.pointIndex, 0, point);
                }

                redoItems.push(action);

                if (autosave) {
                    if (tracks.length === 0)
                        Database.delete();
                    else
                        Database.save();
                }
            }
        }

        function redo() {
            if (canRedo()) {
                const action = redoItems.pop();
                const t = action.actionType;
                const d = action.data;

                if (t === ActionTypes.addPoint) {
                    let track;
                    if (d.newTrack) {
                        track = [];
                        tracks.push(track);
                    } else
                        track = tracks[d.trackIndex];
                    const point = new TrackPoint(d.long, d.lat, d.cat, d.type);
                    track.splice(d.pointIndex, 0, point);
                } else if (t === ActionTypes.movePoint) {
                    const point = tracks[d.trackIndex][d.pointIndex];
                    point.long = d.long1;
                    point.lat = d.lat1;
                } else if (t === ActionTypes.modifyPoint) {
                    const point = tracks[d.trackIndex][d.pointIndex];
                    point.cat = d.newCat;
                    point.type = d.newType;
                } else if (t === ActionTypes.deletePoint) {
                    const track = tracks[d.trackIndex];
                    const point = track[d.pointIndex];
                    track.splice(d.pointIndex, 1);
                    if (point === selectedDot && track.length > 0)
                        selectedDot = track[track.length - 1];
                    if (track.length < 1) {
                        tracks.splice(d.trackIndex, 1);
                        if (track === selectedTrack)
                            deselectTrack();
                    }
                }

                undoItems.push(action);

                if (autosave) {
                    if (tracks.length === 0)
                        Database.delete();
                    else
                        Database.save();
                }
            }
        }

        function record(actionType, data) {
            undoItems.push({ actionType, data });
            redoItems = [];
        }

        function reset() {
            undoItems = [];
            redoItems = [];
        }

        function canUndo() {
            return undoItems.length > 0;
        }

        function canRedo() {
            return redoItems.length > 0;
        }

        return { undo, redo, record, reset, ActionTypes, canUndo, canRedo };
    })();

    // Mouse UI //

    _p5.mouseWheel = function (evt) {
        if (!isValidMousePosition() || !loadedMapImg) return;

        const zoomSensitivity = 1 / 125;
        const viewerW = WIDTH;
        const viewerH = WIDTH / 2;
        const mouseRelativeY = mouseY - (HEIGHT - viewerH);

        // calc for zooming
        const oldViewW = mapViewWidth();
        const oldViewH = mapViewHeight();

        zoomAmt = constrain(zoomAmt - evt.delta * zoomSensitivity, 0, 15);

        const newViewW = mapViewWidth();
        const newViewH = mapViewHeight();

        // adjust pan for zoom - will keep the mouse position constant
        const viewChange = {
            w: oldViewW - newViewW,
            h: oldViewH - newViewH
        };

        panLocation.long += viewChange.w * mouseX / viewerW;
        panLocation.lat -= viewChange.h * mouseRelativeY / viewerH;

        // snap to bounds
        panLocation.long = normalizeLongitude(panLocation.long);
        panLocation.lat = constrainLatitude(panLocation.lat, newViewH);

        return false;
    };

    _p5.mousePressed = function () {
        if (mouseButton !== LEFT || !isValidMousePosition() || !loadedMapImg) return;

        beginClickX = mouseX;
        beginClickY = mouseY;

        if (!saveLoadReady) {
            mouseMode = 0;
            return;
        }
        if (deleteTrackPoints) {
            mouseMode = 3;
            return;
        }
        if (hoverTrack === selectedTrack && hoverDot && hoverDot === selectedDot) {
            mouseMode = 2;
            beginPointMoveLong = selectedDot.long;
            beginPointMoveLat = selectedDot.lat;
            return;
        }

        mouseMode = 0;
    };

    _p5.mouseReleased = function () {
        if (mouseButton !== LEFT || !beginClickX || !beginClickY) return;

        const handleAddPoint = () => {
            if (!hoverTrack && !saveLoadReady) return;

            if (hoverTrack) {
                selectedTrack = hoverTrack;
                selectedDot = hoverDot;
                return;
            }

            let insertIndex = 0;
            if (!selectedTrack) {
                selectedTrack = [];
                tracks.push(selectedTrack);
            } else {
                insertIndex = selectedTrack.indexOf(selectedDot) + 1;
            }

            try {
                selectedDot = new TrackPoint(mouseLong(), mouseLat(), categoryToPlace, typeToPlace);
                selectedTrack.splice(insertIndex, 0, selectedDot);

                History.record(History.ActionTypes.addPoint, {
                    trackIndex: tracks.indexOf(selectedTrack),
                    pointIndex: insertIndex,
                    long: selectedDot.long,
                    lat: selectedDot.lat,
                    cat: selectedDot.cat,
                    type: selectedDot.type,
                    newTrack: selectedTrack.length === 1
                });

                if (autosave) Database.save();
            } catch (err) {
                console.error('Error adding track point:', err);
            }
        };

        const handleMovePoint = () => {
            try {
                selectedDot.long = mouseLong();
                selectedDot.lat = mouseLat();
                let trackIndex = tracks.indexOf(selectedTrack);

                History.record(History.ActionTypes.movePoint, {
                    trackIndex,
                    pointIndex: tracks[trackIndex].indexOf(selectedDot),
                    long0: beginPointMoveLong,
                    lat0: beginPointMoveLat,
                    long1: selectedDot.long,
                    lat1: selectedDot.lat
                });

                if (autosave) Database.save();
            } catch (err) {
                console.error('Error moving track point:', err);
            }
            beginPointMoveLong = beginPointMoveLat = undefined;
        };

        const handleDeletePoint = () => {
            for (let i = tracks.length - 1; i >= 0; i--) {
                const track = tracks[i];
                for (let j = track.length - 1; j >= 0; j--) {
                    const point = track[j];
                    const coords = longLatToScreenCoords(point);

                    if (!coords.inBounds ||
                        sqrt(sq(coords.x - mouseX) + sq(coords.y - mouseY)) >= pow(1.25, zoomAmt)) {
                        continue;
                    }

                    try {
                        const trackDeleted = handlePointDeletion(i, j, point);
                        if (autosave) {
                            tracks.length === 0 ? Database.delete() : Database.save();
                        }
                        return;
                    } catch (err) {
                        console.error('Error deleting track point:', err);
                        return;
                    }
                }
            }
        };

        const handlePointDeletion = (trackIndex, pointIndex, point) => {
            let trackDeleted = false;
            const track = tracks[trackIndex];

            track.splice(pointIndex, 1);

            if (point === selectedDot && track.length > 0) {
                selectedDot = track[track.length - 1];
            }

            if (track.length === 0) {
                if (selectedTrack === track) deselectTrack();
                tracks.splice(trackIndex, 1);
                trackDeleted = true;
            } else {
                selectedTrack = track;
            }

            History.record(History.ActionTypes.deletePoint, {
                trackIndex,
                pointIndex,
                long: point.long,
                lat: point.lat,
                cat: point.cat,
                type: point.type,
                trackDeleted
            });

            return trackDeleted;
        };

        const handlers = {
            0: handleAddPoint,
            2: handleMovePoint,
            3: handleDeletePoint
        };

        if (handlers[mouseMode]) {
            handlers[mouseMode]();
        }

        refreshGUI();
        beginClickX = beginClickY = beginPanX = beginPanY = undefined;
    };

    let lastMouseDragged = 0;
    const MOUSE_DRAG_DELAY = 16; // so around ~60 fps

    _p5.mouseDragged = function () {
        if (!isValidMousePosition() || mouseButton !== LEFT || !beginClickX || !beginClickY) return false;

        const now = performance.now();
        if (now - lastMouseDragged < MOUSE_DRAG_DELAY) return false;
        lastMouseDragged = now;

        if (mouseMode === 2 && selectedDot) {
            selectedDot.long = mouseLong();
            selectedDot.lat = mouseLat();
            return false;
        }

        const dragDistance = Math.hypot(mouseX - beginClickX, mouseY - beginClickY);
        if (mouseMode === 1 || dragDistance >= 20) {
            mouseMode = 1;

            if (beginPanX === undefined) beginPanX = panLocation.long;
            if (beginPanY === undefined) beginPanY = panLocation.lat;

            const viewerH = WIDTH / 2;
            const [mvw, mvh] = [mapViewWidth(), mapViewHeight()];
            const [dx, dy] = [mouseX - beginClickX, mouseY - beginClickY];

            panLocation.long = normalizeLongitude(beginPanX - mvw * dx / WIDTH);
            panLocation.lat = constrainLatitude(beginPanY + mvh * dy / viewerH, mvh);
        }

        return false;
    };

    function isValidMousePosition() {
        return mouseX > 0 &&
            mouseX < WIDTH &&
            mouseY > (HEIGHT - WIDTH / 2) &&
            mouseY < HEIGHT;
    }

    function normalizeLongitude(long) {
        if (long < -180) return 180 - (180 - long) % 360;
        if (long >= 180) return (long + 180) % 360 - 180;
        return long;
    }

    function constrainLatitude(lat, viewHeight) {
        return Math.min(90, Math.max(-90 + viewHeight, lat));
    }

    // these seem to be used frequently
    const ZOOM_BASE = 1.25;
    const VIEW_HEIGHT_RATIO = 0.5; // WIDTH/2

    function zoomMult() {
        return pow(ZOOM_BASE, zoomAmt);
    }

    // this is also used frequently, so memoizing it
    const memoizedZoomMult = (() => {
        let lastZoomAmt = null;
        let lastResult = null;
        return () => {
            if (lastZoomAmt !== zoomAmt) {
                lastZoomAmt = zoomAmt;
                lastResult = pow(ZOOM_BASE, zoomAmt);
            }
            return lastResult;
        };
    })();

    function mapViewWidth() {
        return 360 / memoizedZoomMult();
    }

    function mapViewHeight() {
        return 180 / memoizedZoomMult();
    }

    function mouseLong() {
        return panLocation.long + (mouseX * mapViewWidth()) / WIDTH;
    }

    function mouseLat() {
        const relativeY = mouseY - (HEIGHT - WIDTH * VIEW_HEIGHT_RATIO);
        return panLocation.lat - (relativeY * mapViewHeight()) / (WIDTH * VIEW_HEIGHT_RATIO);
    }

    function longLatToScreenCoords(long, lat) {
        if (long instanceof TrackPoint) ({ long, lat } = long);

        const viewWidth = mapViewWidth();
        const viewHeight = mapViewHeight();
        const topBound = HEIGHT - WIDTH * VIEW_HEIGHT_RATIO;

        const x = ((long - panLocation.long + 360) % 360) * WIDTH / viewWidth;
        const y = (panLocation.lat - lat) * (WIDTH * VIEW_HEIGHT_RATIO) / viewHeight + topBound;

        return {
            x,
            y,
            inBounds: x >= 0 && x < WIDTH && y >= topBound && y < HEIGHT
        };
    }
    class TrackPoint {
        constructor(long, lat, cat, type) {
            this.long = long || 0;
            this.lat = lat || 0;
            this.cat = cat || 0;
            this.type = type || 0;
        }
    }

    // GUI //

    let suppresskeybinds = false;

    window.onload = function () {
        const uicontainer = document.querySelector('#ui-container');
        // uicontainer.style.left = (WIDTH + 20) + 'px';

        const mainFragment = new DocumentFragment();

        // Element creation helper
        const createElement = (() => {
            const elementCache = new Map();

            return (type, options = {}) => {
                let element;
                if (!options.id && !options.textContent && elementCache.has(type)) {
                    // clone cached elements
                    element = elementCache.get(type).cloneNode(false);
                } else {
                    element = document.createElement(type);
                    // cache basic elements
                    if (!options.id && !options.textContent) {
                        elementCache.set(type, element.cloneNode(false));
                    }
                }
                Object.assign(element, options);
                return element;
            };
        })();

        // Create a labeled element and append it to a fragment
        function createLabeledElement(id, labelText, element, fragment) {
            const label = createElement('label', { htmlFor: id, textContent: labelText });
            const br = createElement('br');
            fragment.append(label, element, br);
            return element;
        }

        const div = () => createElement('div');
        const dropdownOption = value => createElement('option', { value, textContent: value });

        function dropdown(id, label, data, fragment) {
            const select = createElement('select', { id });
            const options = Object.keys(data)
                .filter(key => Object.prototype.hasOwnProperty.call(data, key))
                .map(key => createElement('option', {
                    value: key,
                    textContent: key
                }));

            select.append(...options);
            return createLabeledElement(id, label, select, fragment);
        }

        function button(label, fragment) {
            const btn = createElement('button', {
                textContent: label,
                className: 'btn'
            });
            fragment.append(btn, createElement('br'));
            return btn;
        }

        function checkbox(id, label, fragment) {
            const cb = createElement('input', {
                type: 'checkbox',
                id
            });
            return createLabeledElement(id, label, cb, fragment);
        }

        function textbox(id, label, fragment) {
            const input = createElement('input', {
                type: 'text',
                id
            });

            input.addEventListener('focus', () => suppresskeybinds = true, { passive: true });
            input.addEventListener('blur', () => suppresskeybinds = false, { passive: true });

            return createLabeledElement(id, label, input, fragment);
        }

        // Undo/Redo //
        const undoredo = div();
        undoredo.id = "undo-redo";
        mainFragment.appendChild(undoredo);

        const createHistoryButton = (text, action) => {
            const undoFragment = new DocumentFragment();
            const btn = button(text, undoFragment);
            btn.classList.add("btn");
            btn.onclick = () => {
                action();
                refreshGUI();
            };
            undoredo.appendChild(undoFragment);
            return btn;
        };

        const undoButton = createHistoryButton('Undo', History.undo);
        const redoButton = createHistoryButton('Redo', History.redo);

        // Dropdowns div //
        const dropdowns = div();
        mainFragment.appendChild(dropdowns);

        const categorySelectData = {
            'Depression': 0,
            'Storm': 1,
            'Category 1': 2,
            'Category 2': 3,
            'Category 3': 4,
            'Category 4': 5,
            'Category 5': 6,
            'Unknown': 7
        };

        const typeSelectData = {
            'Tropical': 0,
            'Subtropical': 1,
            'Non-Tropical': 2
        };

        const dropdownsFragment = new DocumentFragment();
        const categorySelect = dropdown('category-select', 'Select category:', categorySelectData, dropdownsFragment);
        categorySelect.onchange = () => categoryToPlace = categorySelectData[categorySelect.value];

        const typeSelect = dropdown('type-select', 'Select type:', typeSelectData, dropdownsFragment);
        typeSelect.onchange = () => typeToPlace = typeSelectData[typeSelect.value];
        dropdowns.appendChild(dropdownsFragment);

        // Buttons div //
        const buttons = div();
        const buttonsFragment = new DocumentFragment();
        mainFragment.appendChild(buttons);

        const deselectButton = button('Deselect track', buttonsFragment);
        deselectButton.onclick = () => {
            deselectTrack();
            refreshGUI();
        };

        const modifyTrackPointButton = button('Modify track point', buttonsFragment);
        modifyTrackPointButton.onclick = () => {
            if (!selectedDot) return;

            const oldCat = selectedDot.cat;
            const oldType = selectedDot.type;
            selectedDot.cat = categorySelectData[categorySelect.value];
            selectedDot.type = typeSelectData[typeSelect.value];

            History.record(History.ActionTypes.modifyPoint, {
                trackIndex: tracks.indexOf(selectedTrack),
                pointIndex: selectedTrack.indexOf(selectedDot),
                oldCat,
                oldType,
                newCat: selectedDot.cat,
                newType: selectedDot.type
            });

            if (autosave) Database.save();
        };

        buttons.appendChild(buttonsFragment);

        // Checkboxes
        const checkboxFragment = new DocumentFragment();
        const createCheckbox = (id, label, property) => {
            const cb = checkbox(id, label, checkboxFragment);
            cb.onclick = () => {
                window[property] = cb.checked;
            };
            return cb;
        };

        const singleTrackCheckbox = createCheckbox('single-track-checkbox', 'Single track mode', 'hideNonSelectedTracks');
        singleTrackCheckbox.onchange = () => {
            hideNonSelectedTracks = singleTrackCheckbox.checked;
        };

        const deletePointsCheckbox = createCheckbox('delete-points-checkbox', 'Delete track points', 'deleteTrackPoints');
        deletePointsCheckbox.onchange = () => {
            deleteTrackPoints = deletePointsCheckbox.checked;
        };

        const altColorCheckbox = createCheckbox('alt-color-checkbox', 'Use accessible colors', 'useAltColors');
        altColorCheckbox.onchange = () => {
            useAltColors = altColorCheckbox.checked;
        };

        const smallDotCheckbox = createCheckbox('small-dot-checkbox', 'Season summary mode', 'useSmallDots');
        smallDotCheckbox.onchange = () => {
            useSmallDots = smallDotCheckbox.checked;
        };
        const autosaveCheckbox = createCheckbox('autosave-checkbox', 'Autosave', 'autosave');
        autosaveCheckbox.onchange = () => {
            autosave = autosaveCheckbox.checked;
        };
        buttons.appendChild(checkboxFragment);

        // Export/Import UI //
        const exportContainer = div();
        exportContainer.id = "export-container";
        mainFragment.appendChild(exportContainer);

        const exportButtons = div();
        exportButtons.id = "export-buttons";
        exportContainer.appendChild(exportButtons);

        const createExportButton = (text, action) => {
            const exportFragment = new DocumentFragment();
            const btn = button(text, exportFragment);
            btn.classList.add("btn");
            btn.onclick = action;
            exportButtons.appendChild(exportFragment);
            return btn;
        };

        createExportButton('Download Image', () => {
            const canvas = document.querySelector('#defaultCanvas0');
            const link = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            link.download = `hypo-track-${timestamp}.png`;

            canvas.toBlob(function (blob) {
                link.href = URL.createObjectURL(blob);
                link.click();
                URL.revokeObjectURL(link.href);
            }, 'image/png');
        });

        createExportButton('Export HURDAT', () => {
            const hurdat = exportHURDAT();
            const blob = new Blob([hurdat], { type: 'text/plain' });
            const link = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            link.download = `hypo-track-hurdat-${timestamp}.txt`;
            link.href = URL.createObjectURL(blob);
            link.click();
            URL.revokeObjectURL(link.href);
        });

        createExportButton('Export JSON', () => {
            const compressJson = compressJsonCheckbox.checked;
            const json = exportJSON();
            const jsonString = compressJson
                ? JSON.stringify(json)
                : JSON.stringify(json, null, 2);

            const blob = new Blob([jsonString], { type: 'application/json' });
            const link = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            link.download = `hypo-track-json-${timestamp}.json`;
            link.href = URL.createObjectURL(blob);
            link.click();
            URL.revokeObjectURL(link.href);
        });

        const jsonOptionsDiv = div();
        jsonOptionsDiv.style.border = 'none';
        jsonOptionsDiv.style.padding = '.2rem 0 0 0';
        jsonOptionsDiv.style.marginBottom = 0;
        exportContainer.appendChild(jsonOptionsDiv);

        const compressJsonCheckbox = createElement('input', {
            type: 'checkbox',
            id: 'compress-json-checkbox'
        });
        const compressLabel = createElement('label', {
            htmlFor: 'compress-json-checkbox',
            textContent: 'Compress JSON',
            title: 'Minimizes the size of the JSON file by removing unnecessary whitespace. May make the file harder to read, but reduces file size by up to 60%.'
        });
        const compatibilityModeCheckbox = createElement('input', {
            type: 'checkbox',
            id: 'compatibility-mode-checkbox'
        });
        const compatibilityLabel = createElement('label', {
            htmlFor: 'compatibility-mode-checkbox',
            textContent: 'Compatibility mode',
            title: 'Adds missing fields to the HURDAT format. Only applies to HURDAT exports, and necessary for some parsers (like GoldStandardBot).'
        });
        jsonOptionsDiv.appendChild(compressJsonCheckbox);
        jsonOptionsDiv.appendChild(compressLabel);
        jsonOptionsDiv.appendChild(document.createElement('br'));
        jsonOptionsDiv.appendChild(compatibilityModeCheckbox);
        jsonOptionsDiv.appendChild(compatibilityLabel);

        // HURDAT export helpers
        const HURDAT_FORMATS = {
            HEADER: (id, count) => `${id},                STORMNAME,     ${count},\n`,
            ENTRY: `${year}%M%D, %T,  , %Y, %LAT, %LON, %W, %P,\n`
        };

        const SPEEDS = [30, 50, 75, 90, 105, 125, 140];
        const PRESSURES = [1009, 1000, 987, 969, 945, 920, 898, 1012];

        const TYPE_CODES = {
            EX: 'EX',
            SD: 'SD',
            SS: 'SS',
            TD: 'TD',
            TS: 'TS',
            HU: 'HU'
        };

        function getTypeCode(type, cat) {
            if (type === 2) return TYPE_CODES.EX;
            if (type === 1) return cat <= 1 ? TYPE_CODES.SD : TYPE_CODES.SS;
            if (type === 0) {
                if (cat === 0) return TYPE_CODES.TD;
                if (cat === 1) return TYPE_CODES.TS;
                return TYPE_CODES.HU;
            }
        }

        function getWindSpeed(cat) {
            return SPEEDS[Math.min(cat, SPEEDS.length - 1)];
        }

        function getPressure(cat) {
            return PRESSURES[cat];
        }

        const padCache = new Map();
        function padNumber(num, width) {
            const key = num * 100 + width;
            let padded = padCache.get(key);
            if (!padded) {
                padded = num.toString().padStart(width, '0');
                if (padCache.size < 1000) { // prevent unlimited growth
                    padCache.set(key, padded);
                }
            }
            return padded;
        }

        function formatLatLon(val, isLat) {
            let adjustedVal = val;
            if (!isLat) {
                // we need to normalize longitudes to -180 to 180
                // this is so we don't deal with incorrect values
                adjustedVal = ((val + 180) % 360 + 360) % 360 - 180;
            }
            const absVal = Math.abs(adjustedVal);
            const hemisphere = isLat ?
                (adjustedVal >= 0 ? 'N' : 'S') :
                (adjustedVal >= 0 ? 'E' : 'W');
            return absVal.toFixed(1) + hemisphere;
        }

        function exportHURDAT() {
            const year = new Date().getFullYear();
            const parts = [];
            const compatibilityMode = document.getElementById('compatibility-mode-checkbox').checked;

            tracks.forEach((track, index) => {
                if (track.length === 0) return;

                const stormId = 'MT' + padNumber(index + 1, 2) + year;
                const header = HURDAT_FORMATS.HEADER(stormId, track.length);

                const entries = new Array(track.length);
                for (let i = 0; i < track.length; i++) {
                    const point = track[i];
                    const day = Math.floor(i / 4) + 1;
                    const month = Math.floor(day / 31) + 1;
                    const dayOfMonth = day % 31 || 31;
                    const timeOfDay = (i % 4) * 600;

                    let entry = year +
                        padNumber(month, 2) +
                        padNumber(dayOfMonth, 2) +
                        ', ' +
                        padNumber(timeOfDay, 4) +
                        ',  , ' +
                        getTypeCode(point.type, point.cat) +
                        ', ' +
                        formatLatLon(point.lat, true).padStart(5) +
                        ', ' +
                        formatLatLon(point.long, false).padStart(6) +
                        ', ' +
                        String(getWindSpeed(point.cat)).padStart(3) +
                        ', ' +
                        getPressure(point.cat) +
                        ',\n';

                    if (compatibilityMode) {
                        entry = entry.replace(/,\n$/, '') + ', ' + Array(14).fill('-999').join(', ') + ',\n';
                    }

                    entries[i] = entry;
                }

                if (!compatibilityMode) {
                    parts.push(header);
                }
                parts.push(entries.join(''));
                if (!compatibilityMode) {
                    parts.push(header);
                }
            });

            return parts.join('');
        }

        // JSON export helpers
        const STAGE_NAMES = {
            EX: 'Extratropical cyclone',
            SD: 'Subtropical cyclone',
            SS: 'Subtropical cyclone',
            TD: 'Tropical cyclone',
            TS: 'Tropical cyclone',
            HU: 'Tropical cyclone'
        };

        function getStageName(type, cat) {
            const code = getTypeCode(type, cat);
            return STAGE_NAMES[code];
        }

        function exportJSON() {
            const result = [];

            tracks.forEach(track => {
                if (track.length === 0) return;

                track.forEach(point => {
                    result.push({
                        name: "STORMNAME",
                        latitude: formatLatLon(point.lat, true),
                        longitude: formatLatLon(point.long, false),
                        speed: getWindSpeed(point.cat),
                        stage: getStageName(point.type, point.cat)
                    });
                });
            });

            return result;
        }

        // Save/Load UI //
        const saveloadui = div();
        const saveloadFragment = new DocumentFragment();
        mainFragment.appendChild(saveloadui);

        const saveButton = button('Save', saveloadFragment);
        const saveNameTextbox = textbox('save-name-textbox', 'Season save name:', saveloadFragment);
        const loadDropdown = dropdown('load-season-dropdown', 'Load season', {}, saveloadFragment);
        const newSeasonButton = button('New season', saveloadFragment);
        newSeasonButton.style.marginTop = '1rem';
        saveloadui.appendChild(saveloadFragment);

        const refreshLoadDropdown = async () => {
            const saveList = await Database.list();
            const dropdownFragment = new DocumentFragment();
            saveList.forEach(item => dropdownFragment.appendChild(dropdownOption(item)));
            loadDropdown.replaceChildren(dropdownFragment);
            loadDropdown.value = '';
        };

        saveNameTextbox.maxLength = 32;
        const SAVE_NAME_REGEX = /^[a-zA-Z0-9 _\-]{4,32}$/;

        saveButton.onclick = () => {
            if (SAVE_NAME_REGEX.test(saveNameTextbox.value)) {
                saveName = saveNameTextbox.value;
                Database.save();
                refreshGUI();
            } else {
                alert('Save names must be at least 4 characters long and only contain letters, numbers, spaces, underscores, or hyphens');
            }
        };

        loadDropdown.onchange = () => {
            if (loadDropdown.value) {
                saveName = loadDropdown.value;
                Database.load();
                deselectTrack();
                History.reset();
                refreshGUI();
            }
        };

        newSeasonButton.onclick = () => {
            tracks = [];
            saveName = undefined;
            History.reset();
            refreshGUI();
        };

        refreshGUI = () => {
            undoButton.disabled = !History.canUndo();
            redoButton.disabled = !History.canRedo();

            categorySelect.value = Object.keys(categorySelectData).find(k => categorySelectData[k] === categoryToPlace);
            typeSelect.value = Object.keys(typeSelectData).find(k => typeSelectData[k] === typeToPlace);

            singleTrackCheckbox.checked = hideNonSelectedTracks;
            singleTrackCheckbox.disabled = deselectButton.disabled = !selectedTrack;
            deletePointsCheckbox.checked = deleteTrackPoints;
            modifyTrackPointButton.disabled = !selectedDot || !saveLoadReady;
            altColorCheckbox.checked = useAltColors;
            smallDotCheckbox.checked = useSmallDots;
            autosaveCheckbox.checked = autosave;

            saveButton.disabled = loadDropdown.disabled = newSeasonButton.disabled = !saveLoadReady;
            saveNameTextbox.value = saveName || '';

            refreshLoadDropdown();
        };

        uicontainer.appendChild(mainFragment);
        refreshGUI();
    };

    _p5.keyPressed = function () {
        if (suppresskeybinds) return;

        const k = key.toLowerCase();

        const keyActions = {
            'd': () => categoryToPlace = 0,
            's': () => categoryToPlace = 1,
            '1': () => categoryToPlace = 2,
            '2': () => categoryToPlace = 3,
            '3': () => categoryToPlace = 4,
            '4': () => categoryToPlace = 5,
            '5': () => categoryToPlace = 6,
            'u': () => categoryToPlace = 7,
            't': () => typeToPlace = 0,
            'b': () => typeToPlace = 1,
            'x': () => typeToPlace = 2,
            ' ': () => deselectTrack(),
            'h': () => selectedTrack && (hideNonSelectedTracks = !hideNonSelectedTracks),
            'q': () => deleteTrackPoints = !deleteTrackPoints,
            'l': () => useAltColors = !useAltColors,
            'p': () => useSmallDots = !useSmallDots,
            'a': () => autosave = !autosave
        };

        const handleHistoryAction = (isRedo) => {
            if (keyIsDown(CONTROL)) {
                isRedo ? History.redo() : History.undo();
            }
        };

        if (k === 'z' && keyIsDown(CONTROL)) {
            handleHistoryAction(keyIsDown(SHIFT));
            refreshGUI();
            return false;
        }

        if (k === 'y' && keyIsDown(CONTROL)) {
            handleHistoryAction(true);
            refreshGUI();
            return false;
        }

        const action = keyActions[k];
        if (action) {
            action();
            refreshGUI();
            return false;
        }

        return true;
    };

    function deselectTrack() {
        selectedTrack = undefined;
        selectedDot = undefined;
        if (hideNonSelectedTracks)
            hideNonSelectedTracks = false;
    }

    Object.assign(window, _p5);

    return {
        tracks: function () {
            return tracks;
        },
    };
})();