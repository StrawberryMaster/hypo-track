// event handlers for mouse, touch, and keyboard interactions

const Events = (() => {
    
    function pickNearestPoint(x, y, radius) {
        Renderer.buildSpatialIndex();
        const spatialIndex = AppState.getSpatialIndex();
        const range = new Spatial.CircleRange(x, y, radius);
        const candidates = spatialIndex.query(range);
        if (!candidates || candidates.length === 0) return null;
        let best = candidates[0];
        let bestDist = Math.hypot(best.screenX - x, best.screenY - y);
        for (let i = 1; i < candidates.length; i++) {
            const c = candidates[i];
            const d = Math.hypot(c.screenX - x, c.screenY - y);
            if (d < bestDist) { best = c; bestDist = d; }
        }
        return best;
    }

    function setupEventListeners() {
        const canvas = AppState.getCanvas();
        if (!canvas) {
            console.error('Cannot setup event listeners: canvas not initialized');
            return;
        }

        canvas.addEventListener('wheel', (evt) => {
            evt.preventDefault();
            if (!Utils.isValidMousePosition(evt) || !AppState.getLoadedMapImg() || !AppState.getPanLocation()) return;

            const zoomSensitivity = 1 / 125;
            Renderer.setZoomRelative(-evt.deltaY * zoomSensitivity, evt.offsetX, evt.offsetY);
        }, { passive: false });

        canvas.addEventListener('mousedown', (evt) => {
            if (evt.button !== 0 || !Utils.isValidMousePosition(evt) || !AppState.getLoadedMapImg()) return;
            AppState.setBeginClickX(evt.offsetX);
            AppState.setBeginClickY(evt.offsetY);
            AppState.setIsDragging(true);

            const hoverTrack = AppState.getHoverTrack();
            const hoverDot = AppState.getHoverDot();
            const selectedTrack = AppState.getSelectedTrack();
            const selectedDot = AppState.getSelectedDot();

            if (!AppState.getSaveLoadReady()) {
                AppState.setMouseMode(0);
            } else if (AppState.getDeleteTrackPoints()) {
                AppState.setMouseMode(3);
            } else if (hoverTrack && hoverTrack === selectedTrack && hoverDot && hoverDot === selectedDot) {
                AppState.setMouseMode(2);
                AppState.setBeginPointMoveLong(selectedDot.long);
                AppState.setBeginPointMoveLat(selectedDot.lat);
            } else {
                AppState.setMouseMode(0);
            }

            Renderer.requestRedraw();
        });

        canvas.addEventListener('mousemove', (evt) => {
            const oldX = canvas.mouseX;
            const oldY = canvas.mouseY;
            canvas.mouseX = evt.offsetX;
            canvas.mouseY = evt.offsetY;

            const shouldRedraw = AppState.getIsDragging() ||
                (oldX !== canvas.mouseX || oldY !== canvas.mouseY);

            if (shouldRedraw) {
                Renderer.requestRedraw();
            }

            if (!AppState.getIsDragging() || !Utils.isValidMousePosition(evt) || !AppState.getPanLocation()) return;

            const mouseMode = AppState.getMouseMode();
            const selectedDot = AppState.getSelectedDot();

            if (mouseMode === 2 && selectedDot) {
                selectedDot.long = Utils.mouseLong(evt);
                selectedDot.lat = Utils.mouseLat(evt);
                Renderer.requestRedraw();
                return;
            }

            const beginClickX = AppState.getBeginClickX();
            const beginClickY = AppState.getBeginClickY();

            if (mouseMode === 1 || Math.hypot(evt.offsetX - beginClickX, evt.offsetY - beginClickY) >= 20) {
                AppState.setMouseMode(1);
                const panLocation = AppState.getPanLocation();
                if (AppState.getBeginPanX() === undefined) AppState.setBeginPanX(panLocation.long);
                if (AppState.getBeginPanY() === undefined) AppState.setBeginPanY(panLocation.lat);

                const mvw = Utils.mapViewWidth(), mvh = Utils.mapViewHeight();
                const beginPanX = AppState.getBeginPanX();
                const beginPanY = AppState.getBeginPanY();
                panLocation.long = Utils.normalizeLongitude(beginPanX - mvw * (evt.offsetX - beginClickX) / AppState.WIDTH);
                panLocation.lat = Utils.constrainLatitude(beginPanY + mvh * (evt.offsetY - beginClickY) / (AppState.WIDTH / 2), mvh);

                Renderer.requestRedraw();
            }
        });

        canvas.addEventListener('mouseup', (evt) => {
            if (evt.button !== 0 || !AppState.getBeginClickX() || !AppState.getBeginClickY()) return;
            AppState.setIsDragging(false);

            const mouseMode = AppState.getMouseMode();
            const selectedDot = AppState.getSelectedDot();

            if (mouseMode === 0) {
                handleAddPoint(evt);
            } else if (mouseMode === 2 && selectedDot) {
                handleMovePoint(evt);
            } else if (mouseMode === 3) {
                handleDeletePoint(evt);
            }

            AppState.setBeginClickX(undefined);
            AppState.setBeginClickY(undefined);
            AppState.setBeginPanX(undefined);
            AppState.setBeginPanY(undefined);
            const refreshGUI = AppState.getRefreshGUI();
            if (refreshGUI) refreshGUI();
            Renderer.requestRedraw();
        });

        canvas.addEventListener('mouseout', () => {
            if (AppState.getHoverDot() || AppState.getHoverTrack()) {
                AppState.setHoverDot(undefined);
                AppState.setHoverTrack(undefined);
                Renderer.requestRedraw();
            }
        });

        // touch interactions
        canvas.addEventListener('touchstart', (evt) => {
            if (!AppState.getLoadedMapImg() || !AppState.getPanLocation()) return;
            if (evt.touches.length === 0) return;
            evt.preventDefault();

            if (evt.touches.length === 1) {
                // fresh single-touch: allow tap unless it turns into pinch later
                AppState.setSuppressNextTap(false);
                const { x, y } = Utils.getOffsetFromTouch(evt.touches[0]);
                AppState.setTouchStartX(x);
                AppState.setTouchLastX(x);
                AppState.setTouchStartY(y);
                AppState.setTouchLastY(y);
                AppState.setTouchStartedInside(Utils.isValidPositionXY(x, y));
                if (!AppState.getTouchStartedInside()) return;

                AppState.setIsTouching(true);
                AppState.setBeginClickX(x);
                AppState.setBeginClickY(y);
                AppState.setIsDragging(true);

                // emulate hover for selection
                const nearest = pickNearestPoint(x, y, Math.pow(AppState.ZOOM_BASE, AppState.getZoomAmt()));
                if (nearest) {
                    AppState.setHoverTrack(nearest.track);
                    AppState.setHoverDot(nearest.point);
                } else {
                    AppState.setHoverTrack(undefined);
                    AppState.setHoverDot(undefined);
                }

                const hoverTrack = AppState.getHoverTrack();
                const hoverDot = AppState.getHoverDot();
                const selectedTrack = AppState.getSelectedTrack();
                const selectedDot = AppState.getSelectedDot();

                if (!AppState.getSaveLoadReady()) {
                    AppState.setMouseMode(0);
                } else if (AppState.getDeleteTrackPoints()) {
                    AppState.setMouseMode(3);
                } else if (hoverTrack && hoverTrack === selectedTrack && hoverDot && hoverDot === selectedDot) {
                    AppState.setMouseMode(2);
                    AppState.setBeginPointMoveLong(selectedDot.long);
                    AppState.setBeginPointMoveLat(selectedDot.lat);
                } else {
                    AppState.setMouseMode(0);
                }

                // keep hover visuals responsive
                canvas.mouseX = x;
                canvas.mouseY = y;
                Renderer.requestRedraw();
            } else if (evt.touches.length >= 2) {
                // start pinch; ensure we do not create a dot on gesture end
                AppState.setSuppressNextTap(true);
                const [t1, t2] = [evt.touches[0], evt.touches[1]];
                const pinch = AppState.getPinch();
                pinch.active = true;
                pinch.startDist = Utils.distanceBetweenTouches(t1, t2);
                pinch.startZoom = AppState.getZoomAmt();
                const mid = Utils.midpointBetweenTouches(t1, t2);
                pinch.startCenterX = mid.x;
                pinch.startCenterY = mid.y;
            }
        }, { passive: false });

        canvas.addEventListener('touchmove', (evt) => {
            if (!AppState.getLoadedMapImg() || !AppState.getPanLocation()) return;
            if (evt.touches.length === 0) return;
            evt.preventDefault();

            const pinch = AppState.getPinch();
            if (evt.touches.length >= 2 && pinch.active) {
                // still pinching; keep suppressing any tap
                AppState.setSuppressNextTap(true);
                const [t1, t2] = [evt.touches[0], evt.touches[1]];
                const dist = Utils.distanceBetweenTouches(t1, t2);
                const scale = dist / (pinch.startDist || dist);
                const deltaZoom = Math.log(scale) / Math.log(AppState.ZOOM_BASE);
                const mid = Utils.midpointBetweenTouches(t1, t2);
                Renderer.setZoomAbsolute(pinch.startZoom + deltaZoom, mid.x, mid.y);
                return;
            }

            // single-finger pan or move point
            if (evt.touches.length === 1 && AppState.getIsTouching() && AppState.getTouchStartedInside()) {
                const { x, y } = Utils.getOffsetFromTouch(evt.touches[0]);
                canvas.mouseX = x;
                canvas.mouseY = y;

                const mouseMode = AppState.getMouseMode();
                const selectedDot = AppState.getSelectedDot();

                if (mouseMode === 2 && selectedDot) {
                    // moving a point
                    const fakeEvt = { offsetX: x, offsetY: y };
                    selectedDot.long = Utils.mouseLong(fakeEvt);
                    selectedDot.lat = Utils.mouseLat(fakeEvt);
                    Renderer.requestRedraw();
                    AppState.setTouchLastX(x);
                    AppState.setTouchLastY(y);
                    return;
                }

                const beginClickX = AppState.getBeginClickX();
                const beginClickY = AppState.getBeginClickY();

                // pan after threshold
                if (mouseMode === 1 || Math.hypot(x - beginClickX, y - beginClickY) >= 20) {
                    AppState.setMouseMode(1);
                    const panLocation = AppState.getPanLocation();
                    if (AppState.getBeginPanX() === undefined) AppState.setBeginPanX(panLocation.long);
                    if (AppState.getBeginPanY() === undefined) AppState.setBeginPanY(panLocation.lat);

                    const mvw = Utils.mapViewWidth(), mvh = Utils.mapViewHeight();
                    const beginPanX = AppState.getBeginPanX();
                    const beginPanY = AppState.getBeginPanY();
                    panLocation.long = Utils.normalizeLongitude(beginPanX - mvw * (x - beginClickX) / AppState.WIDTH);
                    panLocation.lat = Utils.constrainLatitude(beginPanY + mvh * (y - beginClickY) / (AppState.WIDTH / 2), mvh);
                    Renderer.requestRedraw();
                }

                AppState.setTouchLastX(x);
                AppState.setTouchLastY(y);
            }
        }, { passive: false });

        canvas.addEventListener('touchend', (evt) => {
            if (!AppState.getLoadedMapImg() || !AppState.getPanLocation()) return;
            evt.preventDefault();

            const pinch = AppState.getPinch();
            // if a pinch was active and fewer than two touches remain, stop pinching
            if (evt.touches.length < 2 && pinch.active) {
                pinch.active = false;
            }

            const isLastFinger = evt.touches.length === 0;

            // if a pinch/multi-touch occurred during this gesture, suppress any tap actions on last finger up
            if (isLastFinger && AppState.getSuppressNextTap()) {
                AppState.setSuppressNextTap(false);
                AppState.setIsDragging(false);
                AppState.setIsTouching(false);
                AppState.setBeginClickX(undefined);
                AppState.setBeginClickY(undefined);
                AppState.setBeginPanX(undefined);
                AppState.setBeginPanY(undefined);
                const refreshGUI = AppState.getRefreshGUI();
                if (refreshGUI) refreshGUI();
                Renderer.requestRedraw();
                return;
            }

            if (!AppState.getIsTouching()) return;

            AppState.setIsDragging(false);
            AppState.setIsTouching(false);

            // If user tapped (no significant move) and not in drag/move modes, add/select or delete
            const touchStartX = AppState.getTouchStartX();
            const touchStartY = AppState.getTouchStartY();
            const touchLastX = AppState.getTouchLastX();
            const touchLastY = AppState.getTouchLastY();
            const moved = Math.hypot(touchLastX - touchStartX, touchLastY - touchStartY);
            const fakeEvt = { offsetX: touchLastX, offsetY: touchLastY };

            const mouseMode = AppState.getMouseMode();
            const selectedDot = AppState.getSelectedDot();

            if (mouseMode === 0 && moved < 20) {
                // emulate hover selection
                const nearest = pickNearestPoint(touchLastX, touchLastY, Math.pow(AppState.ZOOM_BASE, AppState.getZoomAmt()));
                if (nearest) {
                    AppState.setHoverTrack(nearest.track);
                    AppState.setHoverDot(nearest.point);
                } else {
                    AppState.setHoverTrack(undefined);
                    AppState.setHoverDot(undefined);
                }
                handleAddPoint(fakeEvt);
            } else if (mouseMode === 2 && selectedDot) {
                handleMovePoint(fakeEvt);
            } else if (mouseMode === 3) {
                handleDeletePoint(fakeEvt);
            }

            AppState.setBeginClickX(undefined);
            AppState.setBeginClickY(undefined);
            AppState.setBeginPanX(undefined);
            AppState.setBeginPanY(undefined);
            const refreshGUI = AppState.getRefreshGUI();
            if (refreshGUI) refreshGUI();
            Renderer.requestRedraw();
        }, { passive: false });

        canvas.addEventListener('touchcancel', (evt) => {
            evt.preventDefault();
            const pinch = AppState.getPinch();
            pinch.active = false;
            AppState.setSuppressNextTap(false);
            AppState.setIsTouching(false);
            AppState.setIsDragging(false);
            AppState.setBeginClickX(undefined);
            AppState.setBeginClickY(undefined);
            AppState.setBeginPanX(undefined);
            AppState.setBeginPanY(undefined);
        }, { passive: false });
    }

    function handleAddPoint(evt) {
        const hoverTrack = AppState.getHoverTrack();
        const hoverDot = AppState.getHoverDot();
        
        if (hoverTrack) {
            AppState.setSelectedTrack(hoverTrack);
            AppState.setSelectedDot(hoverDot);
            const refreshGUI = AppState.getRefreshGUI();
            if (refreshGUI) refreshGUI();
            return;
        }

        const selectedTrack = AppState.getSelectedTrack();
        const selectedDot = AppState.getSelectedDot();
        const insertIndex = selectedTrack ? selectedTrack.indexOf(selectedDot) + 1 : 0;
        let track = selectedTrack;
        
        if (!track) {
            track = [];
            AppState.getTracks().push(track);
            AppState.setSelectedTrack(track);
        }

        const newDot = new Models.TrackPoint(
            Utils.mouseLong(evt), 
            Utils.mouseLat(evt), 
            AppState.getCategoryToPlace(), 
            AppState.getTypeToPlace()
        );
        track.splice(insertIndex, 0, newDot);
        AppState.setSelectedDot(newDot);

        // mark spatial index for rebuild
        AppState.setNeedsIndexRebuild(true);

        History.record(History.ActionTypes.addPoint, {
            trackIndex: AppState.getTracks().indexOf(track),
            pointIndex: insertIndex,
            long: newDot.long,
            lat: newDot.lat,
            cat: newDot.cat,
            type: newDot.type,
            newTrack: track.length === 1
        });
        if (AppState.getAutosave()) Database.save();
        Renderer.requestRedraw();
    }

    function handleMovePoint(evt) {
        const selectedDot = AppState.getSelectedDot();
        if (!selectedDot) {
            console.error('Uh oh! handleMovePoint called without a selected dot.');
            return;
        }
        selectedDot.long = Utils.mouseLong(evt);
        selectedDot.lat = Utils.mouseLat(evt);

        // mark spatial index for rebuild
        AppState.setNeedsIndexRebuild(true);

        const selectedTrack = AppState.getSelectedTrack();
        const tracks = AppState.getTracks();
        const trackIndex = tracks.indexOf(selectedTrack);
        if (trackIndex === -1 || !selectedTrack) {
            console.error('Invalid track in handleMovePoint', { selectedTrack, tracks });
            return;
        }
        History.record(History.ActionTypes.movePoint, {
            trackIndex,
            pointIndex: selectedTrack.indexOf(selectedDot),
            long0: AppState.getBeginPointMoveLong(),
            lat0: AppState.getBeginPointMoveLat(),
            long1: selectedDot.long,
            lat1: selectedDot.lat
        });
        if (AppState.getAutosave()) Database.save();
        AppState.setBeginPointMoveLong(undefined);
        AppState.setBeginPointMoveLat(undefined);
        Renderer.requestRedraw();
    }

    function handleDeletePoint(evt) {
        // build spatial index before querying
        Renderer.buildSpatialIndex();

        // create a circular search range
        const searchRadius = Math.pow(AppState.ZOOM_BASE, AppState.getZoomAmt());
        const searchRange = new Spatial.CircleRange(evt.offsetX, evt.offsetY, searchRadius);

        // query the spatial index for points in range
        const spatialIndex = AppState.getSpatialIndex();
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
            const tracks = AppState.getTracks();
            const trackIndex = tracks.indexOf(nearestPoint.track);
            const pointIndex = nearestPoint.track.indexOf(nearestPoint.point);

            if (trackIndex !== -1 && pointIndex !== -1) {
                const trackDeleted = handlePointDeletion(trackIndex, pointIndex, nearestPoint.point);
                if (AppState.getAutosave()) {
                    const tracks = AppState.getTracks();
                    tracks.length === 0 ? Database.delete() : Database.save();
                }
                return;
            }
        }

        Renderer.requestRedraw();
    }

    function handlePointDeletion(trackIndex, pointIndex, point) {
        const tracks = AppState.getTracks();
        const track = tracks[trackIndex];
        track.splice(pointIndex, 1);
        let trackDeleted = false;

        const selectedDot = AppState.getSelectedDot();
        if (point === selectedDot && track.length > 0) {
            AppState.setSelectedDot(track[track.length - 1]);
        }
        
        if (track.length === 0) {
            if (AppState.getSelectedTrack() === track) {
                Utils.deselectTrack();
            }
            tracks.splice(trackIndex, 1);
            trackDeleted = true;
        } else {
            AppState.setSelectedTrack(track);
        }

        History.record(History.ActionTypes.deletePoint, {
            trackIndex,
            pointIndex,
            long: point.long,
            lat: point.lat,
            cat: point.cat,
            type: point.type,
            wind: point.wind,
            pressure: point.pressure,
            trackDeleted
        });
        Renderer.requestRedraw();
        return trackDeleted;
    }

    return {
        setupEventListeners,
        handleAddPoint,
        handleMovePoint,
        handleDeletePoint,
        handlePointDeletion,
        pickNearestPoint
    };
})();
