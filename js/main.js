const HypoTrack = (function () {
    const TITLE = 'HypoTrack';
    const VERSION = '1.0.3';
    const IDB_KEY = 'hypo-track';

    const WIDTH = 1000;
    const HEIGHT = 500;

    const DEFAULT_CATEGORIES = [
        { name: 'Depression', speed: 20, pressure: 1009, color: '#5ebaff', altColor: '#6ec1ea', isDefault: true },
        { name: 'Storm', speed: 35, pressure: 1000, color: '#00faf4', altColor: '#4dffff', isDefault: true },
        { name: 'Category 1', speed: 65, pressure: 987, color: '#ffffcc', altColor: '#ffffd9', isDefault: true },
        { name: 'Category 2', speed: 85, pressure: 969, color: '#ffe775', altColor: '#ffd98c', isDefault: true },
        { name: 'Category 3', speed: 100, pressure: 945, color: '#ffc140', altColor: '#ff9e59', isDefault: true },
        { name: 'Category 4', speed: 115, pressure: 920, color: '#ff8f20', altColor: '#ff738a', isDefault: true },
        { name: 'Category 5', speed: 140, pressure: 898, color: '#ff6060', altColor: '#a188fc', isDefault: true },
        { name: 'Unknown', speed: 0, pressure: 1012, color: '#c0c0c0', altColor: '#c0c0c0', isDefault: true }
    ];

    // QuadTree implementation - for spatial indexing
    class QuadTree {
        constructor(bounds, capacity = 4, maxDepth = 5, depth = 0) {
            this.bounds = bounds; // {x, y, width, height}
            this.capacity = capacity;
            this.maxDepth = maxDepth;
            this.depth = depth;
            this.points = [];
            this.divided = false;
            this.children = null;
        }

        subdivide() {
            const x = this.bounds.x;
            const y = this.bounds.y;
            const w = this.bounds.width / 2;
            const h = this.bounds.height / 2;
            const depth = this.depth + 1;

            const nw = new QuadTree({ x: x, y: y, width: w, height: h },
                this.capacity, this.maxDepth, depth);
            const ne = new QuadTree({ x: x + w, y: y, width: w, height: h },
                this.capacity, this.maxDepth, depth);
            const sw = new QuadTree({ x: x, y: y + h, width: w, height: h },
                this.capacity, this.maxDepth, depth);
            const se = new QuadTree({ x: x + w, y: y + h, width: w, height: h },
                this.capacity, this.maxDepth, depth);

            this.children = { nw, ne, sw, se };
            this.divided = true;

            // redistribute points to children
            for (const point of this.points) {
                this.insertToChild(point);
            }
            this.points = [];
        }

        insertToChild(point) {
            if (this.children.nw.contains(point)) this.children.nw.insert(point);
            else if (this.children.ne.contains(point)) this.children.ne.insert(point);
            else if (this.children.sw.contains(point)) this.children.sw.insert(point);
            else if (this.children.se.contains(point)) this.children.se.insert(point);
        }

        insert(point) {
            if (!this.contains(point)) {
                return false;
            }

            if (!this.divided) {
                if (this.points.length < this.capacity || this.depth >= this.maxDepth) {
                    this.points.push(point);
                    return true;
                } else {
                    this.subdivide();
                }
            }

            if (this.divided) {
                return this.insertToChild(point);
            }
        }

        query(range, found = []) {
            if (!this.intersects(range)) {
                return found;
            }

            for (const point of this.points) {
                if (range.contains(point)) {
                    found.push(point);
                }
            }

            if (this.divided) {
                this.children.nw.query(range, found);
                this.children.ne.query(range, found);
                this.children.sw.query(range, found);
                this.children.se.query(range, found);
            }

            return found;
        }

        clear() {
            this.points = [];
            if (this.divided) {
                this.children.nw.clear();
                this.children.ne.clear();
                this.children.sw.clear();
                this.children.se.clear();
                this.divided = false;
                this.children = null;
            }
        }

        contains(point) {
            return point.screenX >= this.bounds.x &&
                point.screenX <= this.bounds.x + this.bounds.width &&
                point.screenY >= this.bounds.y &&
                point.screenY <= this.bounds.y + this.bounds.height;
        }

        intersects(range) {
            return !(range.x > this.bounds.x + this.bounds.width ||
                range.x + range.width < this.bounds.x ||
                range.y > this.bounds.y + this.bounds.height ||
                range.y + range.height < this.bounds.y);
        }
    }

    // Circle range for point queries
    class CircleRange {
        constructor(x, y, radius) {
            this.x = x - radius;
            this.y = y - radius;
            this.width = radius * 2;
            this.height = radius * 2;
            this.centerX = x;
            this.centerY = y;
            this.radius = radius;
        }

        contains(point) {
            // if the point is within the circle's radius
            const distance = Math.hypot(point.screenX - this.centerX, point.screenY - this.centerY);
            return distance <= this.radius;
        }
    }

    // state variables
    let canvas, ctx, mapImgs = {}, customMapImg = null, useCustomMap = false,
        currentMapName = 'Default', panLocation, zoomAmt = 0, tracks = [],
        categoryToPlace = 0, typeToPlace = 0, hoverDot, hoverTrack, selectedDot, selectedTrack,
        hideNonSelectedTracks = false, deleteTrackPoints = false, useAltColors = false,
        useSmallDots = false, saveName, autosave = true, saveLoadReady = true,
        isDragging = false, beginClickX, beginClickY, beginPanX, beginPanY,
        beginPointMoveLong, beginPointMoveLat, mouseMode, loadedMapImg = false,
        customCategories = [], masterCategories = [];

    // folder management state
    let folders = [], currentView = { type: 'root' }, selectedBrowserItems = new Set();

    // spatial index for tracks
    let spatialIndex = null;
    let needsIndexRebuild = true;

    // redraw control variables
    let needsRedraw = true, isRedrawScheduled = false;

    let refreshGUI;

    const ZOOM_BASE = 1.25;
    const VIEW_HEIGHT_RATIO = 0.5;

    function regenerateMasterCategories() {
        masterCategories = [...DEFAULT_CATEGORIES, ...customCategories];
        if (refreshGUI) {
            refreshGUI();
        }
    }

    function init() {
        // update database version if necessary
        if (Dexie.getDatabaseNames) {
            Dexie.getDatabaseNames().then(names => {
                if (names.includes(IDB_KEY)) {
                    const tempDb = new Dexie(IDB_KEY);
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

        document.title = TITLE;
        canvas = document.createElement('canvas');
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        const container = document.getElementById('canvas-container');
        if (!container) {
            console.error('Zoinks! Canvas container not found.');
            return;
        }

        container.style.position = 'relative';
        container.appendChild(canvas);
        createCoordinatesTab(container);

        ctx = canvas.getContext('2d');

        panLocation = { long: -180, lat: 90 };

        Database.loadCategories().then(loaded => {
            customCategories = loaded;
            regenerateMasterCategories();
        }).catch(err => {
            console.error("Jinkies! Failed to load custom categories:", err);
            regenerateMasterCategories();
        });


        requestRedraw();

        loadImages().then(() => {
            loadedMapImg = true;
            requestRedraw();
        }).catch(err => console.error('Jinkies! Failed to load images:', err));

        setupEventListeners();

        // initialize spatial index
        spatialIndex = new QuadTree({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
    }

    function requestRedraw() {
        needsRedraw = true;
        if (!isRedrawScheduled) {
            isRedrawScheduled = true;
            requestAnimationFrame(draw);
        }
    }

    async function loadImages() {
        if (useCustomMap && currentMapName !== 'Default') {
            // check localStorage first
            const localMaps = getCustomMapsFromLocal();
            if (localMaps[currentMapName]) {
                try {
                    const arrayBuffer = base64ToArrayBuffer(localMaps[currentMapName]);
                    const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
                    const url = URL.createObjectURL(blob);
                    customMapImg = new Image();
                    customMapImg.decoding = 'async';
                    await new Promise((resolve, reject) => {
                        customMapImg.onload = () => {
                            URL.revokeObjectURL(url);
                            resolve();
                        };
                        customMapImg.onerror = (err) => {
                            URL.revokeObjectURL(url);
                            reject(err);
                        };
                        customMapImg.src = url;
                    });
                    loadedMapImg = true;
                    return;
                } catch (error) {
                    console.error('Failed to load custom map from localStorage:', error);
                    useCustomMap = false;
                }
            } else {
                // fallback to IndexedDB
                try {
                    const mapData = await Database.loadMap(currentMapName);
                    if (mapData) {
                        const blob = new Blob([mapData], { type: 'image/jpeg' });
                        const url = URL.createObjectURL(blob);
                        customMapImg = new Image();
                        customMapImg.decoding = 'async';
                        await new Promise((resolve, reject) => {
                            customMapImg.onload = () => {
                                URL.revokeObjectURL(url);
                                resolve();
                            };
                            customMapImg.onerror = (err) => {
                                URL.revokeObjectURL(url);
                                reject(err);
                            };
                            customMapImg.src = url;
                        });
                        loadedMapImg = true;
                        return;
                    }
                } catch (error) {
                    console.error('Error loading custom map from IndexedDB:', error);
                    useCustomMap = false;
                }
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

            // revoke URLs after all images are loaded
            urls.forEach(url => URL.revokeObjectURL(url));

            Object.assign(mapImgs, Object.fromEntries(
                Array.from(IMAGE_PATHS.keys()).map((key, i) => [key, images[i]])
            ));
        } catch (error) {
            console.error('Image loading failed:', error);
            mapImgs = {};
            throw error;
        }
    }

    function draw() {
        isRedrawScheduled = false;
        if (!needsRedraw) return;
        needsRedraw = false;

        const zMult = Math.pow(ZOOM_BASE, zoomAmt);
        const viewW = 360 / zMult;
        const viewH = viewW * (HEIGHT / WIDTH);

        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        if (!loadedMapImg) {
            ctx.fillStyle = '#000';
            ctx.font = '48px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Loading...', WIDTH / 2, HEIGHT / 2);
            requestRedraw();
            return;
        }

        drawMap(viewW, viewH);
        drawTracks(viewW, viewH);
    }

    function drawMap() {
        const topBound = HEIGHT - WIDTH / 2;
        const mvw = mapViewWidth();
        const mvh = mapViewHeight();
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

            let dx = WIDTH * (qw - west) / mvw;
            let dw = WIDTH * (qe - qw) / mvw;
            let dy = (HEIGHT - topBound) * (qn - north) / (south - north) + topBound;
            let dh = (HEIGHT - topBound) * (qs - qn) / (south - north);

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
                roundedDx + roundedDw > 0 && roundedDx < WIDTH &&
                sx < img.width && sy < img.height
            ) {
                ctx.drawImage(img, sx, sy, sw, sh, roundedDx, roundedDy, roundedDw, roundedDh);
            } else {
                // fallback: fill with a placeholder color if zoom is too extreme
                ctx.fillStyle = "#efefef";
                ctx.fillRect(roundedDx, roundedDy, roundedDw, roundedDh);
            }
        }

        if (useCustomMap && customMapImg) {
            const mapWest = -180;
            const mapEast = 180;
            const mapNorth = 90;
            const mapSouth = -90;

            const minLong = Math.floor((west - mvw) / 360) * 360;
            const maxLong = Math.ceil((east + mvw) / 360) * 360;

            for (let offset = minLong; offset < maxLong; offset += 360) {
                const qw = Math.max(west, mapWest + offset);
                const qe = Math.min(east, mapEast + offset);
                if (qw < qe) {
                    drawSection(
                        customMapImg,
                        mapWest, mapEast, mapNorth, mapSouth,
                        qw, qe, north, south,
                        offset
                    );
                }
            }
            return;
        }

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

    function buildSpatialIndex() {
        if (!needsIndexRebuild) return;

        spatialIndex.clear();

        const viewWidth = mapViewWidth();
        const viewHeight = mapViewHeight();

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            for (let j = 0; j < track.length; j++) {
                const point = track[j];
                const screenCoords = longLatToScreenCoords(point);

                if (screenCoords.inBounds) {
                    const indexPoint = {
                        screenX: screenCoords.x,
                        screenY: screenCoords.y,
                        point: point,
                        track: track
                    };

                    spatialIndex.insert(indexPoint);
                }

                const worldWidth = WIDTH * zoomMult();

                const leftPoint = {
                    screenX: screenCoords.x - worldWidth,
                    screenY: screenCoords.y,
                    point: point,
                    track: track
                };
                if (leftPoint.screenX > -100 && leftPoint.screenX < WIDTH + 100) {
                    spatialIndex.insert(leftPoint);
                }

                const rightPoint = {
                    screenX: screenCoords.x + worldWidth,
                    screenY: screenCoords.y,
                    point: point,
                    track: track
                };
                if (rightPoint.screenX > -100 && rightPoint.screenX < WIDTH + 100) {
                    spatialIndex.insert(rightPoint);
                }
            }
        }

        needsIndexRebuild = false;
    }

    function drawTracks() {
        let dotSize = 2 * Math.pow(ZOOM_BASE, zoomAmt);
        ctx.lineWidth = dotSize / 9;
        if (useSmallDots) dotSize *= 9 / 15;
        const worldWidth = WIDTH * zoomMult();
        const viewWidth = mapViewWidth();
        const viewHeight = mapViewHeight();

        // mark the spatial index for rebuild
        needsIndexRebuild = true;

        // our pool of reusable objects
        const coordsPool = [];
        let poolIndex = 0;

        function getCoords() {
            return coordsPool[poolIndex++] || (coordsPool[poolIndex - 1] = { x: 0, y: 0, inBounds: false });
        }

        function longLatToScreenCoordsPooled(d, out) {
            out.x = ((d.long - panLocation.long + 360) % 360) / viewWidth * WIDTH;
            out.y = (panLocation.lat - d.lat) / viewHeight * WIDTH / 2 + HEIGHT - WIDTH / 2;
            out.inBounds = out.x >= 0 && out.x < WIDTH && out.y >= (HEIGHT - WIDTH / 2) && out.y < HEIGHT;
        }

        hoverTrack = undefined;
        hoverDot = undefined;

        // first pass: draw tracks and points
        for (let i = 0; i < tracks.length; i++) {
            if (!hideNonSelectedTracks || selectedTrack === tracks[i]) {
                const isSelected = selectedTrack === tracks[i] && !hideNonSelectedTracks;
                ctx.strokeStyle = isSelected ? '#ffff00' : '#ffffff';
                ctx.beginPath();

                for (let j = 0; j < tracks[i].length - 1; j++) {
                    const d = tracks[i][j];
                    const d1 = tracks[i][j + 1];
                    const coords = getCoords();
                    const coords1 = getCoords();
                    longLatToScreenCoordsPooled(d, coords);
                    longLatToScreenCoordsPooled(d1, coords1);

                    let x0 = coords.x, x1 = coords1.x;
                    if (x1 - x0 > worldWidth / 2) x1 -= worldWidth;
                    else if (x1 - x0 < -worldWidth / 2) x1 += worldWidth;

                    ctx.moveTo(x0, coords.y);
                    ctx.lineTo(x1, coords1.y);
                    ctx.moveTo(x0 - worldWidth, coords.y);
                    ctx.lineTo(x1 - worldWidth, coords1.y);
                    ctx.moveTo(x0 + worldWidth, coords.y);
                    ctx.lineTo(x1 + worldWidth, coords1.y);
                }
                ctx.stroke();
            }
        }

        for (let i = 0; i < tracks.length; i++) {
            if (!hideNonSelectedTracks || selectedTrack === tracks[i]) {
                for (let j = 0; j < tracks[i].length; j++) {
                    const d = tracks[i][j];
                    const coords = getCoords();
                    longLatToScreenCoordsPooled(d, coords);

                    const category = masterCategories[d.cat];
                    if (category) {
                        ctx.fillStyle = useAltColors ? category.altColor : category.color;
                    } else {
                        ctx.fillStyle = '#000000';
                    }

                    function mark(x) {
                        if (x >= -dotSize / 2 && x < WIDTH + dotSize / 2 &&
                            coords.y >= (HEIGHT - WIDTH / 2) - dotSize / 2 && coords.y < HEIGHT + dotSize / 2) {
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

                            ctx.strokeStyle = hideNonSelectedTracks ? 'transparent' :
                                selectedDot === d ? '#ff0000' :
                                    selectedTrack === tracks[i] ? '#ffff00' :
                                        'transparent';

                            if (ctx.strokeStyle !== 'transparent') {
                                ctx.stroke();
                            }
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
        const mouseX = canvas.mouseX || 0, mouseY = canvas.mouseY || 0;
        if (canvas.mouseX !== undefined && canvas.mouseY !== undefined) {
            for (let i = tracks.length - 1; i >= 0; i--) {
                if (!hideNonSelectedTracks || selectedTrack === tracks[i]) {
                    for (let j = tracks[i].length - 1; j >= 0; j--) {
                        const d = tracks[i][j];
                        const c = getCoords();
                        longLatToScreenCoordsPooled(d, c);
                        if (c.inBounds && Math.hypot(c.x - mouseX, c.y - mouseY) < Math.pow(ZOOM_BASE, zoomAmt)) {
                            hoverDot = d;
                            hoverTrack = tracks[i];
                            break;
                        }
                    }
                }
            }
        }
    }

    // Mouse UI/interaction //
    function setupEventListeners() {
        canvas.addEventListener('wheel', (evt) => {
            evt.preventDefault();
            if (!isValidMousePosition(evt) || !loadedMapImg || !panLocation) return;

            const zoomSensitivity = 1 / 125;
            const oldViewW = mapViewWidth(), oldViewH = mapViewHeight();
            zoomAmt = Math.max(0, Math.min(15, zoomAmt - evt.deltaY * zoomSensitivity));
            const newViewW = mapViewWidth(), newViewH = mapViewHeight();

            panLocation.long += (oldViewW - newViewW) * evt.offsetX / WIDTH;
            panLocation.lat -= (oldViewH - newViewH) * (evt.offsetY - (HEIGHT - WIDTH / 2)) / (WIDTH / 2);
            panLocation.long = normalizeLongitude(panLocation.long);
            panLocation.lat = constrainLatitude(panLocation.lat, newViewH);

            requestRedraw();
        }, { passive: false });

        canvas.addEventListener('mousedown', (evt) => {
            if (evt.button !== 0 || !isValidMousePosition(evt) || !loadedMapImg) return;
            beginClickX = evt.offsetX;
            beginClickY = evt.offsetY;
            isDragging = true;

            if (!saveLoadReady) {
                mouseMode = 0;
            } else if (deleteTrackPoints) {
                mouseMode = 3;
            } else if (hoverTrack && hoverTrack === selectedTrack && hoverDot && hoverDot === selectedDot) {
                mouseMode = 2;
                beginPointMoveLong = selectedDot.long;
                beginPointMoveLat = selectedDot.lat;
            } else {
                mouseMode = 0;
            }

            requestRedraw();
        });

        canvas.addEventListener('mousemove', (evt) => {
            const oldX = canvas.mouseX;
            const oldY = canvas.mouseY;
            canvas.mouseX = evt.offsetX;
            canvas.mouseY = evt.offsetY;

            const shouldRedraw = isDragging ||
                (oldX !== canvas.mouseX || oldY !== canvas.mouseY);

            if (shouldRedraw) {
                requestRedraw();
            }

            if (!isDragging || !isValidMousePosition(evt) || !panLocation) return;

            if (mouseMode === 2 && selectedDot) {
                selectedDot.long = mouseLong(evt);
                selectedDot.lat = mouseLat(evt);
                requestRedraw();
                return;
            }

            if (mouseMode === 1 || Math.hypot(evt.offsetX - beginClickX, evt.offsetY - beginClickY) >= 20) {
                mouseMode = 1;
                if (beginPanX === undefined) beginPanX = panLocation.long;
                if (beginPanY === undefined) beginPanY = panLocation.lat;

                const mvw = mapViewWidth(), mvh = mapViewHeight();
                panLocation.long = normalizeLongitude(beginPanX - mvw * (evt.offsetX - beginClickX) / WIDTH);
                panLocation.lat = constrainLatitude(beginPanY + mvh * (evt.offsetY - beginClickY) / (WIDTH / 2), mvh);

                requestRedraw();
            }
        });

        canvas.addEventListener('mouseup', (evt) => {
            if (evt.button !== 0 || !beginClickX || !beginClickY) return;
            isDragging = false;

            if (mouseMode === 0) {
                handleAddPoint(evt);
            } else if (mouseMode === 2 && selectedDot) {
                handleMovePoint(evt);
            } else if (mouseMode === 3) {
                handleDeletePoint(evt);
            }

            beginClickX = beginClickY = beginPanX = beginPanY = undefined;
            if (refreshGUI) refreshGUI();
            requestRedraw();
        });

        canvas.addEventListener('mouseout', () => {
            if (hoverDot || hoverTrack) {
                hoverDot = undefined;
                hoverTrack = undefined;
                requestRedraw();
            }
        });
    }

    function handleAddPoint(evt) {
        if (hoverTrack) {
            selectedTrack = hoverTrack;
            selectedDot = hoverDot;
            return;
        }

        const insertIndex = selectedTrack ? selectedTrack.indexOf(selectedDot) + 1 : 0;
        if (!selectedTrack) {
            selectedTrack = [];
            tracks.push(selectedTrack);
        }

        selectedDot = new TrackPoint(mouseLong(evt), mouseLat(evt), categoryToPlace, typeToPlace);
        selectedTrack.splice(insertIndex, 0, selectedDot);

        // mark spatial index for rebuild
        needsIndexRebuild = true;

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
        requestRedraw();
    }

    function handleMovePoint(evt) {
        if (!selectedDot) {
            console.error('Uh oh! handleMovePoint called without a selected dot.');
            return;
        }
        selectedDot.long = mouseLong(evt);
        selectedDot.lat = mouseLat(evt);

        // mark spatial index for rebuild
        needsIndexRebuild = true;

        const trackIndex = tracks.indexOf(selectedTrack);
        if (trackIndex === -1 || !selectedTrack) {
            console.error('Invalid track in handleMovePoint', { selectedTrack, tracks });
            return;
        }
        History.record(History.ActionTypes.movePoint, {
            trackIndex,
            pointIndex: selectedTrack.indexOf(selectedDot),
            long0: beginPointMoveLong,
            lat0: beginPointMoveLat,
            long1: selectedDot.long,
            lat1: selectedDot.lat
        });
        if (autosave) Database.save();
        beginPointMoveLong = beginPointMoveLat = undefined;
        requestRedraw();
    }

    function handleDeletePoint(evt) {
        // build spatial index before querying
        buildSpatialIndex();

        // create a circular search range
        const searchRadius = Math.pow(ZOOM_BASE, zoomAmt);
        const searchRange = new CircleRange(evt.offsetX, evt.offsetY, searchRadius);

        // query the spatial index for points in range
        const candidatePoints = spatialIndex.query(searchRange);

        if (candidatePoints.length > 0) {
            // find the nearest point
            let nearestPoint = candidatePoints[0];
            let minDistance = Math.hypot(nearestPoint.screenX - evt.offsetX, nearestPoint.screenY - evt.offsetY);

            for (let i = 1; i < candidatePoints.length; i++) {
                const distance = Math.hypot(candidatePoints[i].screenX - evt.offsetX, candidatePoints[i].screenY - evt.offsetY);
                if (distance < minDistance) {
                    minDistance = distance;
                    nearestPoint = candidatePoints[i];
                }
            }

            // get the track and point indexes
            const trackIndex = tracks.indexOf(nearestPoint.track);
            const pointIndex = nearestPoint.track.indexOf(nearestPoint.point);

            if (trackIndex !== -1 && pointIndex !== -1) {
                const trackDeleted = handlePointDeletion(trackIndex, pointIndex, nearestPoint.point);
                if (autosave) tracks.length === 0 ? Database.delete() : Database.save();
                return;
            }
        }

        requestRedraw();
    }

    function handlePointDeletion(trackIndex, pointIndex, point) {
        const track = tracks[trackIndex];
        track.splice(pointIndex, 1);
        let trackDeleted = false;

        if (point === selectedDot && track.length > 0) selectedDot = track[track.length - 1];
        if (track.length === 0) {
            if (selectedTrack === track) deselectTrack();
            tracks.splice(trackIndex, 1);
            trackDeleted = true;
        } else selectedTrack = track;

        History.record(History.ActionTypes.deletePoint, {
            trackIndex,
            pointIndex,
            long: point.long,
            lat: point.lat,
            cat: point.cat,
            type: point.type,
            trackDeleted
        });
        requestRedraw();
        return trackDeleted;
    }

    function isValidMousePosition(evt) {
        const x = evt.offsetX, y = evt.offsetY;
        return x > 0 && x < WIDTH && y > (HEIGHT - WIDTH / 2) && y < HEIGHT;
    }

    function normalizeLongitude(long) {
        return ((long + 180) % 360 + 360) % 360 - 180;
    }

    function constrainLatitude(lat, viewHeight) {
        return Math.min(90, Math.max(-90 + viewHeight, lat));
    }

    function zoomMult() {
        return Math.pow(ZOOM_BASE, zoomAmt);
    }

    function mapViewWidth() {
        return 360 / zoomMult();
    }

    function mapViewHeight() {
        return 180 / zoomMult();
    }

    function mouseLong(evt) {
        return panLocation.long + (evt.offsetX * mapViewWidth()) / WIDTH;
    }

    function mouseLat(evt) {
        const relativeY = evt.offsetY - (HEIGHT - WIDTH * VIEW_HEIGHT_RATIO);
        return panLocation.lat - (relativeY * mapViewHeight()) / (WIDTH * VIEW_HEIGHT_RATIO);
    }

    function longLatToScreenCoords({ long, lat }) {
        const viewWidth = mapViewWidth();
        const viewHeight = mapViewHeight();
        const topBound = HEIGHT - WIDTH * VIEW_HEIGHT_RATIO;
        const x = ((long - panLocation.long + 360) % 360) * WIDTH / viewWidth;
        const y = (panLocation.lat - lat) * (WIDTH * VIEW_HEIGHT_RATIO) / viewHeight + topBound;
        return { x, y, inBounds: x >= 0 && x < WIDTH && y >= topBound && y < HEIGHT };
    }

    class TrackPoint {
        constructor(long, lat, cat, type) {
            this.long = long || 0;
            this.lat = lat || 0;
            this.cat = cat || 0;
            this.type = type || 0;
        }
    }

    const Database = (() => {
        const db = new Dexie(IDB_KEY);
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
            if (!saveLoadReady) return;
            saveLoadReady = false;
            try {
                await operation();
            } catch (error) {
                console.error(`Jinkies. An error occurred: ${error.message}`);
                throw error;
            } finally {
                saveLoadReady = true;
                if (refreshGUI) refreshGUI();
            }
        }

        const getKey = () => saveName || 'Autosave';

        return {
            save: async () => {
                if (performance.now() - lastSave < SAVE_DELAY) return;
                lastSave = performance.now();
                await withLock(() => db.saves.put(tracks, getKey()));
            },
            load: async () => {
                await withLock(async () => {
                    tracks = (await db.saves.get(getKey())) || [];
                    tracks.forEach(track => track.forEach((point, i) => track[i] = Object.assign(new TrackPoint(), point)));

                    // mark spatial index for rebuild
                    needsIndexRebuild = true;
                });
            },
            list: () => db.saves.toCollection().primaryKeys(),
            delete: async (keyToDelete) => await withLock(() => db.saves.delete(keyToDelete || getKey())),

            saveMap: async (name, imageData) => await withLock(() => db.maps.put(imageData, name)),
            loadMap: (name) => db.maps.get(name),
            listMaps: () => db.maps.toCollection().primaryKeys(),
            deleteMap: async (name) => await withLock(() => db.maps.delete(name)),

            saveCategories: async (categories) => await withLock(() => db.categories.bulkPut(categories)),
            deleteCategory: async (categoryName) => await withLock(() => db.categories.delete(categoryName)),
            loadCategories: () => db.categories.toArray(),

            saveFolders: async (foldersToSave) => await withLock(() => db.folders.bulkPut(foldersToSave)),
            deleteFolder: async (folderName) => await withLock(() => db.folders.delete(folderName)),
            loadFolders: () => db.folders.toArray()
        };
    })();


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
            if (!canUndo()) return;
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
                    if (track === selectedTrack) deselectTrack();
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
                } else track = tracks[d.trackIndex];
                const point = new TrackPoint(d.long, d.lat, d.cat, d.type);
                track.splice(d.pointIndex, 0, point);
            }

            redoItems.push(action);
            if (autosave) tracks.length === 0 ? Database.delete() : Database.save();

            // mark spatial index for rebuild
            needsIndexRebuild = true;

            requestRedraw();
        }

        function redo() {
            if (!canRedo()) return;
            const action = redoItems.pop();
            const t = action.actionType;
            const d = action.data;

            if (t === ActionTypes.addPoint) {
                let track;
                if (d.newTrack) {
                    track = [];
                    tracks.push(track);
                } else track = tracks[d.trackIndex];
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
                    if (track === selectedTrack) deselectTrack();
                }
            }

            undoItems.push(action);
            if (autosave) tracks.length === 0 ? Database.delete() : Database.save();

            // mark spatial index for rebuild
            needsIndexRebuild = true;

            requestRedraw();
        }

        function record(actionType, data) {
            undoItems.push({ actionType, data });
            redoItems = [];
            requestRedraw();
        }

        function reset() {
            undoItems = [];
            redoItems = [];
            requestRedraw();
        }

        function canUndo() {
            return undoItems.length > 0;
        }

        function canRedo() {
            return redoItems.length > 0;
        }

        return { undo, redo, record, reset, ActionTypes, canUndo, canRedo };
    })();

    function parseCoordinate(str) {
        if (typeof str !== 'string') return parseFloat(str) || 0;
        let value = parseFloat(str);
        const lastChar = str.trim().slice(-1).toUpperCase();
        if (lastChar === 'S' || lastChar === 'W') value = -value;
        return value;
    }

    function importJSONFile(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const json = JSON.parse(reader.result);
                let tracksData = [];

                // handle different JSON formats
                if (json.tracks && Array.isArray(json.tracks)) {
                    // e.g.: { tracks: [[...], [...]] }
                    tracksData = json.tracks;
                } else if (Array.isArray(json)) {
                    // simple array of points
                    tracksData = [json];
                } else {
                    alert('Invalid JSON format. Expected an array of tracks or an object with a "tracks" property.');
                    return;
                }

                tracks = tracksData.map(trackData =>
                    trackData.map(pointData => {
                        let cat = -1;
                        // first, try to match by category name
                        if (pointData.category) {
                            cat = masterCategories.findIndex(c => c.name === pointData.category);
                        }
                        // if not found, fall back to matching by speed
                        if (cat === -1 && pointData.speed !== undefined) {
                            let closestSpeedCat = -1;
                            let smallestDiff = Infinity;
                            DEFAULT_CATEGORIES.forEach((c, index) => {
                                if (pointData.speed >= c.speed) {
                                    const diff = pointData.speed - c.speed;
                                    if (diff < smallestDiff) {
                                        smallestDiff = diff;
                                        closestSpeedCat = index;
                                    }
                                }
                            });
                            cat = closestSpeedCat;
                        }
                        if (cat === -1) {
                            cat = masterCategories.findIndex(c => c.name === 'Unknown');
                        }

                        const type = pointData.stage === 'Extratropical cyclone' ? 2 :
                            pointData.stage === 'Subtropical cyclone' ? 1 : 0;

                        return new TrackPoint(
                            parseCoordinate(pointData.longitude),
                            parseCoordinate(pointData.latitude),
                            cat,
                            type
                        );
                    })
                );
                Database.save();
                History.reset();
                deselectTrack();
                if (refreshGUI) refreshGUI();
            } catch (error) {
                alert('Error importing JSON: ' + error.message);
            }
        };
        reader.readAsText(file);
    }

    // HURDAT export helpers
    const HURDAT_FORMATS = {
        HEADER: (id, count) => `${id},                STORMNAME,     ${count},\n`,
        ENTRY: (year, month, day, time, type, lat, lon, wind, pressure) =>
            `${year}${month}${day}, ${time},  , ${type}, ${lat}, ${lon}, ${wind}, ${pressure},\n`
    };
    const TYPE_CODES = { EX: 'EX', SD: 'SD', SS: 'SS', TD: 'TD', TS: 'TS', HU: 'HU' };

    function getTypeCode(type, cat) {
        const wind = getWindSpeed(cat);
        if (type === 2) return TYPE_CODES.EX;
        if (type === 1) {
            return wind < 34 ? TYPE_CODES.SD : TYPE_CODES.SS;
        }
        if (type === 0) {
            if (wind < 34) return TYPE_CODES.TD;
            if (wind < 64) return TYPE_CODES.TS;
            return TYPE_CODES.HU;
        }
        return '  ';
    }

    function getWindSpeed(cat) {
        return masterCategories[cat]?.speed || 0;
    }

    function getPressure(cat) {
        return masterCategories[cat]?.pressure || 1015;
    }

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

    function updateCoordinatesDisplay() {
        const coordTab = document.getElementById('coordinates-tab');
        const latElement = document.getElementById('coord-lat');
        const lonElement = document.getElementById('coord-lon');

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

    function exportHURDAT(decimalPlaces = 1) {
        const year = new Date().getFullYear();
        const parts = [];
        const compatibilityMode = document.getElementById('compatibility-mode-checkbox')?.checked || false;

        tracks.forEach((track, index) => {
            if (track.length === 0) return;
            const stormId = 'MT' + padNumber(index + 1, 2) + year;
            const header = HURDAT_FORMATS.HEADER(stormId, track.length);
            const entries = track.map((point, i) => {
                const day = Math.floor(i / 4) + 1;
                const month = Math.floor(day / 31) + 1;
                const dayOfMonth = day % 31 || 31;
                const timeOfDay = padNumber((i % 4) * 600, 4);
                let entry = HURDAT_FORMATS.ENTRY(
                    year,
                    padNumber(month, 2),
                    padNumber(dayOfMonth, 2),
                    timeOfDay,
                    getTypeCode(point.type, point.cat),
                    formatLatLon(point.lat, true, decimalPlaces).padStart(5),
                    formatLatLon(point.long, false, decimalPlaces).padStart(6),
                    String(getWindSpeed(point.cat)).padStart(3),
                    getPressure(point.cat)
                );
                if (compatibilityMode) entry = entry.replace(/,\n$/, '') + ', ' + Array(14).fill('-999').join(', ') + ',\n';
                return entry;
            });

            if (!compatibilityMode) parts.push(header);
            parts.push(entries.join(''));
            if (!compatibilityMode) parts.push(header);
        });
        return parts.join('');
    }

    const STAGE_NAMES = {
        EX: 'Extratropical cyclone', SD: 'Subtropical cyclone', SS: 'Subtropical cyclone',
        TD: 'Tropical cyclone', TS: 'Tropical cyclone', HU: 'Tropical cyclone'
    };

    function getStageName(type, cat) {
        return STAGE_NAMES[getTypeCode(type, cat)];
    }

    function exportJSON(decimalPlaces = 1) {
        const result = { tracks: [] };
        tracks.forEach((track, trackIndex) => {
            if (track.length === 0) return;
            const stormName = `STORM ${trackIndex + 1}`;
            result.tracks.push(track.map(point => ({
                name: stormName,
                latitude: formatLatLon(point.lat, true, decimalPlaces),
                longitude: formatLatLon(point.long, false, decimalPlaces),
                speed: getWindSpeed(point.cat),
                pressure: getPressure(point.cat),
                category: masterCategories[point.cat]?.name || 'Unknown',
                stage: getStageName(point.type, point.cat)
            })));
        });
        return result;
    }

    const LOCAL_MAPS_KEY = 'hypo-track-local-custom-maps';

    function saveCustomMapToLocal(name, data) {
        const maps = getCustomMapsFromLocal();
        const base64 = arrayBufferToBase64(data);
        maps[name] = base64;
        localStorage.setItem(LOCAL_MAPS_KEY, JSON.stringify(maps));
    }

    function getCustomMapsFromLocal() {
        try {
            return JSON.parse(localStorage.getItem(LOCAL_MAPS_KEY) || '{}');
        } catch {
            return {};
        }
    }

    function deleteCustomMapFromLocal(name) {
        const maps = getCustomMapsFromLocal();
        delete maps[name];
        localStorage.setItem(LOCAL_MAPS_KEY, JSON.stringify(maps));
    }

    function arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Convert base64 string to ArrayBuffer.
     * @param {string} b64
     * @returns {ArrayBuffer}
     */
    function base64ToArrayBuffer(b64) {
        const binary = atob(b64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    window.onload = () => {
        init();
        const uiContainer = document.getElementById('ui-container');
        if (!uiContainer) {
            console.error('UI container not found!');
            return;
        }

        // for the folder UI
        const style = document.createElement('style');
        style.textContent = `
            #season-browser { border: 1px solid #ccc; height: 150px; overflow-y: auto; background: #f9f9f9; margin: 5px 0; border-radius: 3px; }
            .browser-item { padding: 4px 8px; cursor: pointer; user-select: none; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 6px; font-size: 13px; }
            .browser-item:last-child { border-bottom: none; }
            .browser-item:hover { background: #e9e9e9; }
            .browser-item.selected { background: #a0c4ff; color: #000; font-weight: bold; }
            .folder-item::before { content: '📁'; }
            .season-item::before { content: '🌀'; }
            #browser-header { display: flex; align-items: center; margin-top: 1rem; gap: 5px; }
            #browser-path { font-weight: bold; color: #555; background: #eee; padding: 4px 8px; border-radius: 3px; flex-grow: 1; }
            #browser-back-btn { padding: 2px 8px; }
            #browser-actions { display: flex; gap: 5px; flex-wrap: wrap; }
            #browser-actions .btn { flex-grow: 1; }
        `;
        document.head.appendChild(style);

        // GUI //
        let suppresskeybinds = false;
        let categoryEditorModal;

        const mainFragment = document.createDocumentFragment();

        const createElement = (() => {
            const elementCache = new Map();
            return (type, options = {}) => {
                let element = !options.id && !options.textContent && elementCache.get(type)?.cloneNode(false) ||
                    document.createElement(type);
                if (!options.id && !options.textContent) elementCache.set(type, element.cloneNode(false));
                Object.assign(element, options);
                return element;
            };
        })();

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
            const options = Object.keys(data).map(key => createElement('option', { value: key, textContent: key }));
            select.append(...options);
            return createLabeledElement(id, label, select, fragment);
        }

        function button(label, fragment) {
            const btn = createElement('button', { textContent: label, className: 'btn' });
            fragment.append(btn, createElement('br'));
            return btn;
        }

        function checkbox(id, label, fragment) {
            const cb = createElement('input', { type: 'checkbox', id });
            return createLabeledElement(id, label, cb, fragment);
        }

        function textbox(id, label, fragment) {
            const input = createElement('input', { type: 'text', id });
            input.addEventListener('focus', () => suppresskeybinds = true, { passive: true });
            input.addEventListener('blur', () => suppresskeybinds = false, { passive: true });
            return createLabeledElement(id, label, input, fragment);
        }

        const undoredo = div();
        undoredo.id = "undo-redo";
        mainFragment.appendChild(undoredo);

        const undoButton = button('Undo', new DocumentFragment());
        undoButton.onclick = () => { History.undo(); refreshGUI(); };
        const redoButton = button('Redo', new DocumentFragment());
        redoButton.onclick = () => { History.redo(); refreshGUI(); };
        undoredo.append(undoButton, redoButton);

        const dropdowns = div();
        mainFragment.appendChild(dropdowns);
        const dropdownsFragment = new DocumentFragment();

        const categorySelect = createElement('select', { id: 'category-select' });
        createLabeledElement('category-select', 'Select category:', categorySelect, dropdownsFragment);
        categorySelect.onchange = () => categoryToPlace = parseInt(categorySelect.value, 10);

        const typeSelectData = { 'Tropical': 0, 'Subtropical': 1, 'Non-Tropical': 2 };
        const typeSelect = dropdown('type-select', 'Select type:', typeSelectData, dropdownsFragment);
        typeSelect.onchange = () => typeToPlace = typeSelectData[typeSelect.value];
        dropdowns.appendChild(dropdownsFragment);

        const buttons = div();
        const buttonsFragment = new DocumentFragment();
        mainFragment.appendChild(buttons);

        const deselectButton = button('Deselect track', buttonsFragment);
        deselectButton.onclick = () => { deselectTrack(); refreshGUI(); };
        const modifyTrackPointButton = button('Modify track point', buttonsFragment);
        modifyTrackPointButton.onclick = () => {
            if (!selectedDot) return;
            const oldCat = selectedDot.cat, oldType = selectedDot.type;
            selectedDot.cat = parseInt(categorySelect.value, 10);
            selectedDot.type = typeSelectData[typeSelect.value];
            History.record(History.ActionTypes.modifyPoint, {
                trackIndex: tracks.indexOf(selectedTrack),
                pointIndex: selectedTrack.indexOf(selectedDot),
                oldCat, oldType, newCat: selectedDot.cat, newType: selectedDot.type
            });
            if (autosave) Database.save();
            requestRedraw();
        };
        buttons.appendChild(buttonsFragment);

        const checkboxFragment = new DocumentFragment();
        const singleTrackCheckbox = checkbox('single-track-checkbox', 'Single track mode', checkboxFragment);
        singleTrackCheckbox.onchange = () => hideNonSelectedTracks = singleTrackCheckbox.checked;
        const deletePointsCheckbox = checkbox('delete-points-checkbox', 'Delete track points', checkboxFragment);
        deletePointsCheckbox.onchange = () => deleteTrackPoints = deletePointsCheckbox.checked;
        const altColorCheckbox = checkbox('alt-color-checkbox', 'Use accessible colors', checkboxFragment);
        altColorCheckbox.onchange = () => useAltColors = altColorCheckbox.checked;
        const smallDotCheckbox = checkbox('small-dot-checkbox', 'Season summary mode', checkboxFragment);
        smallDotCheckbox.onchange = () => useSmallDots = smallDotCheckbox.checked;
        const autosaveCheckbox = checkbox('autosave-checkbox', 'Autosave', checkboxFragment);
        autosaveCheckbox.checked = true;
        autosaveCheckbox.onchange = () => autosave = autosaveCheckbox.checked;
        buttons.appendChild(checkboxFragment);

        // Save/Load UI //
        const saveloadContainer = div();
        saveloadContainer.id = 'saveload-container';
        mainFragment.appendChild(saveloadContainer);

        const saveloadTitle = createElement('h3', { textContent: 'Season management' });
        saveloadTitle.style.cssText = 'margin: 0 0 .5rem 0;';
        saveloadContainer.appendChild(saveloadTitle);

        const saveControls = div();
        const saveNameTextbox = textbox('save-name-textbox', 'Season name:', saveControls);
        saveNameTextbox.maxLength = 32;
        const saveButton = button('Save current', saveControls);
        saveloadContainer.appendChild(saveControls);

        const browserHeader = div();
        browserHeader.id = 'browser-header';
        const backButton = button('..', new DocumentFragment());
        backButton.id = 'browser-back-btn';
        const browserPathSpan = createElement('span', { id: 'browser-path' });
        browserHeader.append(backButton, browserPathSpan);
        saveloadContainer.appendChild(browserHeader);

        const seasonBrowserDiv = div();
        seasonBrowserDiv.id = 'season-browser';
        saveloadContainer.appendChild(seasonBrowserDiv);

        const browserActions = div();
        browserActions.id = 'browser-actions';
        const newFolderButton = button('New folder', new DocumentFragment());
        const moveSelectionButton = button('Move to...', new DocumentFragment());
        const deleteSelectionButton = button('Delete', new DocumentFragment());
        const newSeasonButton = button('New season', new DocumentFragment());
        browserActions.append(newFolderButton, moveSelectionButton, deleteSelectionButton, newSeasonButton);
        saveloadContainer.appendChild(browserActions);

        // Custom Category Management UI //
        const catManagementContainer = div();
        catManagementContainer.id = "cat-management-container";
        mainFragment.appendChild(catManagementContainer);

        const catManagementTitle = createElement('h3', { textContent: 'Custom categories' });
        catManagementTitle.style.margin = '.2rem 0 .5rem 0';
        catManagementContainer.appendChild(catManagementTitle);
        const catManagementFragment = new DocumentFragment();
        const addCategoryButton = button('Add new category', catManagementFragment);
        addCategoryButton.onclick = () => openCategoryEditor(null);
        const customCategoryListDiv = div();
        customCategoryListDiv.id = 'custom-category-list';
        catManagementFragment.append(customCategoryListDiv);
        catManagementContainer.appendChild(catManagementFragment);


        // Custom maps UI //
        const mapsContainer = div();
        mapsContainer.id = "maps-container";
        mainFragment.appendChild(mapsContainer);

        const mapsTitle = createElement('h3', { textContent: 'Custom maps' });
        mapsTitle.style.margin = '.2rem 0 .5rem 0';
        mapsContainer.appendChild(mapsTitle);

        const mapsFragment = new DocumentFragment();
        const customMapCheckbox = checkbox('use-custom-map-checkbox', 'Use custom map', mapsFragment);
        customMapCheckbox.onchange = () => {
            useCustomMap = customMapCheckbox.checked;
            loadImages().then(() => {
                loadedMapImg = true;
                requestRedraw();
            }).catch(err => console.error('Zoinks! Failed to load images:', err));
        };

        const mapDropdown = createElement('select', { id: 'custom-map-dropdown' });
        createLabeledElement('custom-map-dropdown', 'Select map:', mapDropdown, mapsFragment);
        mapDropdown.onchange = () => {
            if (mapDropdown.value) {
                currentMapName = mapDropdown.value;
                if (useCustomMap) {
                    loadImages().then(() => {
                        loadedMapImg = true;
                        requestRedraw();
                    }).catch(err => console.error('Yikes! Failed to load images:', err));
                }
            }
        };

        const uploadMapButton = button('Upload map', mapsFragment);
        uploadMapButton.onclick = () => {
            const fileInput = createElement('input', { type: 'file', accept: 'image/*' });
            fileInput.style.display = 'none';
            fileInput.onchange = () => {
                if (fileInput.files.length > 0) {
                    const file = fileInput.files[0];
                    const mapNamePrompt = prompt('Select a name for the map (4-32 characters, letters, numbers, spaces, _ or -):', currentMapName);
                    const MAP_NAME_REGEX = /^[a-zA-Z0-9 _\-]{4,32}$/;

                    if (mapNamePrompt && MAP_NAME_REGEX.test(mapNamePrompt)) {
                        const reader = new FileReader();
                        reader.onload = async () => {
                            try {
                                await Database.saveMap(mapNamePrompt, new Uint8Array(reader.result));
                                saveCustomMapToLocal(mapNamePrompt, reader.result);
                                alert(`Map "${mapNamePrompt}" saved successfully.`);
                                refreshMapDropdown();
                                currentMapName = mapNamePrompt;
                                useCustomMap = true;
                                customMapCheckbox.checked = true;
                                loadImages().then(() => {
                                    loadedMapImg = true;
                                    requestRedraw();
                                });
                            } catch (error) {
                                alert(`Jinkies! Error saving map: ${error.message}`);
                            }
                        };
                        reader.readAsArrayBuffer(file);
                    } else {
                        alert('Invalid map name. Please use 4-32 characters, letters, numbers, spaces, _ or -.');
                    }
                    fileInput.value = "";
                }
            };
            document.body.appendChild(fileInput);
            fileInput.click();
            document.body.removeChild(fileInput);
        };

        const deleteMapButton = button('Delete map', mapsFragment);
        deleteMapButton.onclick = async () => {
            if (currentMapName === 'Default') {
                alert('One does not simply delete the default map.');
                return;
            }

            if (confirm(`You sure you want to delete the map "${currentMapName}"?`)) {
                try {
                    await Database.deleteMap(currentMapName);
                    deleteCustomMapFromLocal(currentMapName); // Remove from localStorage too
                    alert(`Map "${currentMapName}" deleted successfully. Aaand it's gone.`);

                    customMapImg = null;
                    currentMapName = 'Default';
                    useCustomMap = false;
                    customMapCheckbox.checked = false;

                    await refreshMapDropdown();
                    await loadImages();
                    loadedMapImg = true;
                    requestRedraw();
                } catch (error) {
                    alert(`Well, this is awkward. Error deleting map: ${error.message}`);
                    console.error('Delete map error:', error);
                }
            }
        };


        mapsContainer.appendChild(mapsFragment);

        // Export/Import UI //
        const exportContainer = div();
        exportContainer.id = "export-container";
        mainFragment.appendChild(exportContainer);

        const exportButtons = div();
        exportButtons.id = "export-buttons";
        exportContainer.appendChild(exportButtons);

        const decimalPlacesDiv = div();
        decimalPlacesDiv.style.cssText = 'border: none; margin: 0; padding: .1rem .2rem';
        const decimalPlacesLabel = createElement('label', { htmlFor: 'decimal-places-dropdown', textContent: 'Decimal places (lat/lon): ' });
        const decimalPlacesDropdown = createElement('select', { id: 'decimal-places-dropdown' });
        [0, 1, 2, 3, 4, 5].forEach(n => {
            const opt = createElement('option', { value: n, textContent: n });
            if (n === 1) opt.selected = true;
            decimalPlacesDropdown.appendChild(opt);
        });
        decimalPlacesDiv.append(decimalPlacesLabel, decimalPlacesDropdown);
        exportContainer.appendChild(decimalPlacesDiv);

        const createExportButton = (text, action) => {
            const btn = button(text, new DocumentFragment());
            btn.classList.add("btn");
            btn.onclick = action;
            exportButtons.appendChild(btn);
            return btn;
        };

        createExportButton('Download Image', () => {
            const link = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            link.download = `hypo-track-${timestamp}.png`;
            canvas.toBlob(blob => {
                link.href = URL.createObjectURL(blob);
                link.click();
                URL.revokeObjectURL(link.href);
            }, 'image/png');
        });

        createExportButton('Export HURDAT', () => {
            const decimalPlaces = parseInt(decimalPlacesDropdown.value, 10);
            const hurdat = exportHURDAT(decimalPlaces);
            const blob = new Blob([hurdat], { type: 'text/plain' });
            const link = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            link.download = `hypo-track-hurdat-${timestamp}.txt`;
            link.href = URL.createObjectURL(blob);
            link.click();
            URL.revokeObjectURL(link.href);
        });

        createExportButton('Export JSON', () => {
            const compressJson = document.getElementById('compress-json-checkbox').checked;
            const decimalPlaces = parseInt(decimalPlacesDropdown.value, 10);
            const json = exportJSON(decimalPlaces);
            const jsonString = compressJson ? JSON.stringify(json) : JSON.stringify(json, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const link = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            link.download = `hypo-track-json-${timestamp}.json`;
            link.href = URL.createObjectURL(blob);
            link.click();
            URL.revokeObjectURL(link.href);
        });

        createExportButton('Import JSON', () => {
            const fileInput = createElement('input', { type: 'file', accept: 'application/json' });
            fileInput.style.display = 'none';
            fileInput.onchange = () => {
                if (fileInput.files.length > 0) {
                    importJSONFile(fileInput.files[0]);
                    fileInput.value = ""; // reset input after processing
                }
            };
            document.body.appendChild(fileInput);
            fileInput.click();
            document.body.removeChild(fileInput);
        });

        const jsonOptionsDiv = div();
        jsonOptionsDiv.style.cssText = 'border: none; padding: .2rem 0 0 0; margin-bottom: 0;';
        exportContainer.appendChild(jsonOptionsDiv);
        jsonOptionsDiv.append(
            createElement('input', { type: 'checkbox', id: 'compress-json-checkbox' }),
            createElement('label', { htmlFor: 'compress-json-checkbox', textContent: 'Compress JSON', title: 'Minimizes the size of the JSON file by removing unnecessary whitespace. May make the file harder to read, but reduces file size by up to 60%.' }),
            createElement('br'),
            createElement('input', { type: 'checkbox', id: 'compatibility-mode-checkbox' }),
            createElement('label', { htmlFor: 'compatibility-mode-checkbox', textContent: 'Compatibility mode', title: 'Adds missing fields to the HURDAT format. Only applies to HURDAT exports, and necessary for some parsers (like GoldStandardBot).' })
        );

        // --- Folder management logic ---
        const SAVE_NAME_REGEX = /^[a-zA-Z0-9 _\-]{4,32}$/;

        function clearBrowserSelection() {
            document.querySelectorAll('.browser-item.selected').forEach(el => el.classList.remove('selected'));
            selectedBrowserItems.clear();
            updateBrowserActionButtons();
        }

        function updateBrowserActionButtons() {
            const hasSelection = selectedBrowserItems.size > 0;
            moveSelectionButton.disabled = !hasSelection;
            deleteSelectionButton.disabled = !hasSelection;
        }

        async function refreshSeasonBrowser() {
            const allSaves = await Database.list();
            folders = await Database.loadFolders();

            const browserDiv = document.getElementById('season-browser');
            browserDiv.innerHTML = '';

            const assignedSaves = new Set(folders.flatMap(f => f.seasons));
            let itemsToShow = [];

            if (currentView.type === 'root') {
                const unassignedSaves = allSaves.filter(s => !assignedSaves.has(s));
                const folderItems = folders.map(f => ({ type: 'folder', name: f.name }));
                const seasonItems = unassignedSaves.map(s => ({ type: 'season', name: s }));
                itemsToShow = [...folderItems, ...seasonItems];
                browserPathSpan.textContent = 'All seasons';
                backButton.disabled = true;
            } else { // 'folder' view
                const folder = folders.find(f => f.name === currentView.name);
                if (folder) {
                    itemsToShow = folder.seasons
                        .filter(sName => allSaves.includes(sName)) // ensure season exists
                        .map(s => ({ type: 'season', name: s }));
                    browserPathSpan.textContent = `📁 ${currentView.name}`;
                }
                backButton.disabled = false;
            }

            itemsToShow.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).forEach(item => {
                const itemDiv = createElement('div', {
                    className: `browser-item ${item.type}-item`,
                    textContent: item.name,
                });
                itemDiv.dataset.name = item.name;
                itemDiv.dataset.type = item.type;
                if (saveName && item.name === saveName) itemDiv.classList.add('selected');

                itemDiv.addEventListener('click', (e) => {
                    const itemName = item.name;
                    if (!e.ctrlKey && !e.metaKey) {
                        clearBrowserSelection();
                    }
                    if (selectedBrowserItems.has(itemName)) {
                        selectedBrowserItems.delete(itemName);
                        itemDiv.classList.remove('selected');
                    } else {
                        selectedBrowserItems.add(itemName);
                        itemDiv.classList.add('selected');
                    }
                    updateBrowserActionButtons();
                });

                itemDiv.addEventListener('dblclick', () => {
                    if (item.type === 'folder') {
                        currentView = { type: 'folder', name: item.name };
                        clearBrowserSelection();
                        refreshSeasonBrowser();
                    } else if (item.type === 'season') {
                        if (saveLoadReady) {
                            saveName = item.name;
                            Database.load().then(() => {
                                deselectTrack();
                                History.reset();
                                refreshGUI();
                            });
                        }
                    }
                });
                browserDiv.appendChild(itemDiv);
            });
            updateBrowserActionButtons();
        }

        backButton.onclick = () => {
            if (currentView.type === 'folder') {
                currentView = { type: 'root' };
                clearBrowserSelection();
                refreshSeasonBrowser();
            }
        };

        saveButton.onclick = () => {
            if (SAVE_NAME_REGEX.test(saveNameTextbox.value)) {
                saveName = saveNameTextbox.value;
                Database.save().then(refreshSeasonBrowser);
            } else alert('Save names must be 4-32 characters long and only contain letters, numbers, spaces, underscores, or hyphens.');
        };

        newSeasonButton.onclick = () => {
            tracks = [];
            saveName = undefined;
            deselectTrack();
            History.reset();
            refreshGUI();
        };

        newFolderButton.onclick = () => {
            const folderName = prompt("Enter new folder name (4-32 characters):");
            if (folderName && SAVE_NAME_REGEX.test(folderName)) {
                if (folders.some(f => f.name === folderName)) {
                    alert('A folder with this name already exists.');
                    return;
                }
                Database.saveFolders([{ name: folderName, seasons: [] }]).then(refreshSeasonBrowser);
            } else if (folderName) {
                alert('Invalid folder name. Please use 4-32 characters (letters, numbers, spaces, _, -).');
            }
        };

        deleteSelectionButton.onclick = async () => {
            if (selectedBrowserItems.size === 0) return;
            if (!confirm(`Are you sure you want to delete ${selectedBrowserItems.size} selected item(s)? This cannot be undone.`)) return;

            let foldersToDelete = [];
            let seasonsToDelete = [];

            selectedBrowserItems.forEach(name => {
                const itemEl = document.querySelector(`.browser-item[data-name="${name}"]`);
                if (itemEl.dataset.type === 'folder') foldersToDelete.push(name);
                else seasonsToDelete.push(name);
            });

            // delete folders (only if empty for simplicity)
            for (const folderName of foldersToDelete) {
                const folder = folders.find(f => f.name === folderName);
                if (folder && folder.seasons.length > 0) {
                    alert(`Folder "${folderName}" is not empty. Please move or delete its seasons first.`);
                    continue;
                }
                await Database.deleteFolder(folderName);
            }

            // delete seasons
            for (const seasonName of seasonsToDelete) {
                await Database.delete(seasonName);
                // remove from any folder it might be in
                folders.forEach(f => {
                    const index = f.seasons.indexOf(seasonName);
                    if (index > -1) f.seasons.splice(index, 1);
                });
            }
            await Database.saveFolders(folders);

            clearBrowserSelection();
            refreshSeasonBrowser();
        };

        moveSelectionButton.onclick = async () => {
            if (selectedBrowserItems.size === 0) return;

            const targetableFolders = folders.filter(f => currentView.type === 'root' || f.name !== currentView.name);
            if (targetableFolders.length === 0) {
                alert("No other folders to move to. Create a new folder first.");
                return;
            }

            const destination = prompt("Move selection to folder:\n" + targetableFolders.map(f => `- ${f.name}`).join('\n'));
            if (!destination) return;

            const destFolder = folders.find(f => f.name.toLowerCase() === destination.toLowerCase());
            if (!destFolder) {
                alert(`Folder "${destination}" not found.`);
                return;
            }

            const itemsToMove = [...selectedBrowserItems].filter(name => {
                const el = document.querySelector(`.browser-item[data-name="${name}"]`);
                return el && el.dataset.type === 'season';
            });

            if ([...selectedBrowserItems].some(name => document.querySelector(`.browser-item[data-name="${name}"]`).dataset.type === 'folder')) {
                alert("Moving folders is not yet supported. Please select only seasons to move.");
                return;
            }

            // remove from old folders
            folders.forEach(f => {
                f.seasons = f.seasons.filter(s => !itemsToMove.includes(s));
            });

            // add to new folder
            itemsToMove.forEach(itemName => {
                if (!destFolder.seasons.includes(itemName)) {
                    destFolder.seasons.push(itemName);
                }
            });

            await Database.saveFolders(folders);
            clearBrowserSelection();
            refreshSeasonBrowser();
        };

        async function refreshMapDropdown() {
            try {
                const mapList = await Database.listMaps();
                const localMaps = Object.keys(getCustomMapsFromLocal());
                const options = ['Default', ...mapList, ...localMaps];
                const dropdownFragment = new DocumentFragment();
                options.forEach(item => dropdownFragment.appendChild(dropdownOption(item)));
                mapDropdown.replaceChildren(dropdownFragment);
                mapDropdown.value = currentMapName || 'Default';
            } catch (error) {
                console.error('Jinkies! Failed to refresh map dropdown:', error);
                mapDropdown.replaceChildren(dropdownOption('Default'));
                mapDropdown.value = 'Default';
            }
        }

        function refreshCategoryDropdown() {
            const selectedValue = categorySelect.value;
            categorySelect.innerHTML = '';
            masterCategories.forEach((cat, index) => {
                const opt = createElement('option', { value: index, textContent: cat.name });
                categorySelect.appendChild(opt);
            });
            categorySelect.value = masterCategories.some((c, i) => i == selectedValue) ? selectedValue : categoryToPlace;
        }

        function refreshCustomCategoryList() {
            const listDiv = document.getElementById('custom-category-list');
            if (!listDiv) return;
            listDiv.innerHTML = '';

            customCategories.forEach(cat => {
                const catDiv = div();
                catDiv.className = 'custom-cat-item';
                catDiv.style.cssText = `display: flex; align-items: center; justify-content: space-between; padding: 4px; border-left: 5px solid ${cat.color}; margin-bottom: 2px; background: #eee; border-radius: 3px;`;

                const nameSpan = createElement('span', { textContent: `${cat.name} (${cat.speed}kt, ${cat.pressure}mb)` });

                const buttonsDiv = div();
                const editBtn = createElement('button', { textContent: 'Edit', className: 'btn-small' });
                editBtn.onclick = () => openCategoryEditor(cat);
                const deleteBtn = createElement('button', { textContent: 'Del', className: 'btn-small' });
                deleteBtn.onclick = () => deleteCustomCategory(cat.name);

                buttonsDiv.append(editBtn, deleteBtn);
                catDiv.append(nameSpan, buttonsDiv);
                listDiv.appendChild(catDiv);
            });
        }

        refreshGUI = () => {
            undoButton.disabled = !History.canUndo();
            redoButton.disabled = !History.canRedo();

            refreshCategoryDropdown();
            refreshCustomCategoryList();
            refreshSeasonBrowser();

            categorySelect.value = categoryToPlace;
            typeSelect.value = Object.keys(typeSelectData).find(k => typeSelectData[k] === typeToPlace);

            singleTrackCheckbox.checked = hideNonSelectedTracks;
            singleTrackCheckbox.disabled = deselectButton.disabled = !selectedTrack;
            deletePointsCheckbox.checked = deleteTrackPoints;
            modifyTrackPointButton.disabled = !selectedDot || !saveLoadReady;
            altColorCheckbox.checked = useAltColors;
            smallDotCheckbox.checked = useSmallDots;
            autosaveCheckbox.checked = autosave;
            saveButton.disabled = newSeasonButton.disabled = !saveLoadReady;
            saveNameTextbox.value = saveName || '';

            refreshMapDropdown();
            updateCoordinatesDisplay();
            requestRedraw();
        };

        uiContainer.appendChild(mainFragment);

        // --- Category Editor Modal Logic ---
        function createCategoryEditorModal() {
            const modal = createElement('div', { id: 'category-editor-modal' });
            modal.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 2000; display: none; align-items: center; justify-content: center;`;
            const form = createElement('form');
            form.style.cssText = `background: #f0f0f0; color: #333; padding: 20px; border-radius: 5px; width: 320px; box-shadow: 0 5px 15px rgba(0,0,0,0.3);`;
            form.innerHTML = `
                <h4 id="category-editor-title" style="margin-top: 0;">Edit Category</h4>
                <input type="hidden" id="category-editor-original-name">
                <label style="display:block; margin-bottom: 8px;">Name: <input type="text" id="category-editor-name" required pattern="[a-zA-Z0-9 _\\-]{1,20}" style="width: 100%;"></label>
                <label style="display:block; margin-bottom: 8px;">Color: <input type="color" id="category-editor-color" value="#ffffff"></label>
                <label style="display:block; margin-bottom: 8px;">Alt color (optional): <input type="color" id="category-editor-alt-color" value="#ffffff"></label>
                <label style="display:block; margin-bottom: 8px;">Min. speed (kt): <input type="number" id="category-editor-speed" required min="0" step="1" style="width: 100%;"></label>
                <label style="display:block; margin-bottom: 15px;">Av. pressure (mb): <input type="number" id="category-editor-pressure" required min="800" max="1050" style="width: 100%;"></label>
                <button type="submit" id="category-editor-save" class="btn">Save</button>
                <button type="button" id="category-editor-cancel" class="btn">Cancel</button>
            `;
            modal.appendChild(form);
            document.body.appendChild(modal);

            form.onsubmit = async (e) => {
                e.preventDefault();
                const originalName = document.getElementById('category-editor-original-name').value;
                const newCategory = {
                    name: document.getElementById('category-editor-name').value.trim(),
                    color: document.getElementById('category-editor-color').value,
                    altColor: document.getElementById('category-editor-alt-color').value,
                    speed: parseInt(document.getElementById('category-editor-speed').value, 10),
                    pressure: parseInt(document.getElementById('category-editor-pressure').value, 10)
                };

                if (newCategory.name !== originalName && masterCategories.some(c => c.name === newCategory.name)) {
                    alert("A category with this name already exists.");
                    return;
                }

                if (originalName) {
                    const index = customCategories.findIndex(c => c.name === originalName);
                    if (index > -1) {
                        if (originalName !== newCategory.name) {
                            await Database.deleteCategory(originalName);
                        }
                        customCategories[index] = newCategory;
                    }
                } else {
                    customCategories.push(newCategory);
                }

                await Database.saveCategories(customCategories);
                regenerateMasterCategories();
                modal.style.display = 'none';
                requestRedraw();
            };
            document.getElementById('category-editor-cancel').onclick = () => {
                modal.style.display = 'none';
            };
            return modal;
        }

        async function deleteCustomCategory(categoryName) {
            const catIndexInMaster = masterCategories.findIndex(c => c.name === categoryName);
            if (catIndexInMaster === -1) return;

            const isInUse = tracks.some(track => track.some(point => point.cat === catIndexInMaster));
            if (isInUse) {
                alert(`Cannot delete category "${categoryName}" because it is currently in use by one or more track points.`);
                return;
            }

            if (confirm(`Are you sure you want to delete the category "${categoryName}"? This cannot be undone.`)) {
                customCategories = customCategories.filter(c => c.name !== categoryName);
                await Database.deleteCategory(categoryName);
                regenerateMasterCategories();
                requestRedraw();
            }
        }

        function openCategoryEditor(category = null) {
            if (!categoryEditorModal) return;
            const isEditing = !!category;
            document.getElementById('category-editor-title').textContent = isEditing ? 'Edit category' : 'Add new category';
            document.getElementById('category-editor-original-name').value = isEditing ? category.name : '';
            document.getElementById('category-editor-name').value = isEditing ? category.name : '';
            document.getElementById('category-editor-color').value = isEditing ? category.color : '#888888';
            document.getElementById('category-editor-alt-color').value = isEditing ? category.altColor : '#999999';
            document.getElementById('category-editor-speed').value = isEditing ? category.speed : '150';
            document.getElementById('category-editor-pressure').value = isEditing ? category.pressure : '900';
            categoryEditorModal.style.display = 'flex';
        }

        categoryEditorModal = createCategoryEditorModal();
        refreshGUI();

        document.addEventListener('keydown', (e) => {
            if (suppresskeybinds || document.getElementById('category-editor-modal').style.display === 'flex') return;
            const k = e.key.toLowerCase();
            const keyActions = {
                'd': () => categoryToPlace = 0, 's': () => categoryToPlace = 1,
                '1': () => categoryToPlace = 2, '2': () => categoryToPlace = 3,
                '3': () => categoryToPlace = 4, '4': () => categoryToPlace = 5,
                '5': () => categoryToPlace = 6, 'u': () => categoryToPlace = 7,
                't': () => typeToPlace = 0, 'b': () => typeToPlace = 1, 'x': () => typeToPlace = 2,
                ' ': () => deselectTrack(), 'h': () => selectedTrack && (hideNonSelectedTracks = !hideNonSelectedTracks),
                'q': () => deleteTrackPoints = !deleteTrackPoints, 'l': () => useAltColors = !useAltColors,
                'p': () => useSmallDots = !useSmallDots, 'a': () => autosave = !autosave
            };

            if ((k === 'z' || k === 'y') && e.ctrlKey) {
                e.preventDefault();
                (k === 'y' || e.shiftKey) ? History.redo() : History.undo();
                refreshGUI();
                return;
            }

            if (keyActions[k]) {
                e.preventDefault();
                keyActions[k]();
                refreshGUI();
            }
        });
    };

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

    function deselectTrack() {
        selectedTrack = undefined;
        selectedDot = undefined;
        hoverTrack = undefined;
        hoverDot = undefined;
        if (hideNonSelectedTracks) hideNonSelectedTracks = false;
        requestRedraw();
    }

    return {
        tracks: () => tracks,
        requestRedraw: requestRedraw,
        TITLE: TITLE,
        VERSION: VERSION
    };
})();

window.addEventListener('load', () => {
    HypoTrack;
});