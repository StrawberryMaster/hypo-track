// event handlers for mouse, touch, and keyboard interactions

const Events = (() => {

    const ZOOM_SENSITIVITY = 1 / 125;
    const DRAG_THRESHOLD = 20;

    function pickNearestPoint(x, y, radius) {
        if (AppState.getNeedsIndexRebuild()) {
            Renderer.buildSpatialIndex();
            AppState.setNeedsIndexRebuild(false);
        }

        const spatialIndex = AppState.getSpatialIndex();
        // fallback if index generation failed or is empty
        if (!spatialIndex) return null;

        const range = new Spatial.CircleRange(x, y, radius);
        const candidates = spatialIndex.query(range);

        if (!candidates || candidates.length === 0) return null;

        let best = candidates[0];
        let bestDist = (best.screenX - x) ** 2 + (best.screenY - y) ** 2;
        for (let i = 1; i < candidates.length; i++) {
            const c = candidates[i];
            const d = (c.screenX - x) ** 2 + (c.screenY - y) ** 2;
            if (d < bestDist) {
                best = c;
                bestDist = d;
            }
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
            Renderer.setZoomRelative(-evt.deltaY * ZOOM_SENSITIVITY, evt.offsetX, evt.offsetY);
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

        let isMouseTickRunning = false;

        canvas.addEventListener('mousemove', (evt) => {
            const oldX = canvas.mouseX;
            const oldY = canvas.mouseY;
            canvas.mouseX = evt.offsetX;
            canvas.mouseY = evt.offsetY;

            if (AppState.getIsDragging() || oldX !== canvas.mouseX || oldY !== canvas.mouseY) {
                Renderer.requestRedraw();
            }

            if (isMouseTickRunning) return;

            isMouseTickRunning = true;
            requestAnimationFrame(() => {
                handleMouseMoveLogic(evt);
                isMouseTickRunning = false;
            });
        });

        function handleMouseMoveLogic(evt) {
            if (!AppState.getIsDragging() || !Utils.isValidMousePosition(evt) || !AppState.getPanLocation()) return;

            const mouseMode = AppState.getMouseMode();

            if (mouseMode === 2) {
                const selectedDot = AppState.getSelectedDot();
                if (selectedDot) {
                    selectedDot.long = Utils.mouseLong(evt);
                    selectedDot.lat = Utils.mouseLat(evt);
                    AppState.setNeedsIndexRebuild(true); // Mark index dirty immediately
                    Renderer.requestRedraw();
                }
                return;
            }

            const beginClickX = AppState.getBeginClickX();
            const beginClickY = AppState.getBeginClickY();
            const dist = Math.hypot(evt.offsetX - beginClickX, evt.offsetY - beginClickY);

            if (mouseMode === 1 || dist >= DRAG_THRESHOLD) {
                AppState.setMouseMode(1);
                updatePanPosition(evt.offsetX, evt.offsetY, beginClickX, beginClickY);
                Renderer.requestRedraw();
            }
        }

        canvas.addEventListener('mouseup', (evt) => {
            if (evt.button !== 0 || !AppState.getBeginClickX()) return; // Simplified check

            AppState.setIsDragging(false);
            const mouseMode = AppState.getMouseMode();

            if (mouseMode === 0) handleAddPoint(evt);
            else if (mouseMode === 2) handleMovePoint(evt);
            else if (mouseMode === 3) handleDeletePoint(evt);

            resetInteractionState();
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
            if (!AppState.getLoadedMapImg() || !AppState.getPanLocation() || evt.touches.length === 0) return;
            evt.preventDefault();

            if (evt.touches.length === 1) {
                // fresh single-touch: allow tap unless it turns into pinch later
                AppState.setSuppressNextTap(false);
                const { x, y } = Utils.getOffsetFromTouch(evt.touches[0]);

                AppState.setTouchStartX(x);
                AppState.setTouchLastX(x);
                AppState.setTouchStartY(y);
                AppState.setTouchLastY(y);

                if (!Utils.isValidPositionXY(x, y)) {
                    AppState.setTouchStartedInside(false);
                    return;
                }

                AppState.setTouchStartedInside(true);
                AppState.setIsTouching(true);
                AppState.setBeginClickX(x);
                AppState.setBeginClickY(y);
                AppState.setIsDragging(true);

                // emulate hover for selection
                const radius = Math.pow(AppState.ZOOM_BASE, AppState.getZoomAmt());
                const nearest = pickNearestPoint(x, y, radius);

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

                canvas.mouseX = x;
                canvas.mouseY = y;
                Renderer.requestRedraw();

            } else if (evt.touches.length >= 2) {
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

        let isTouchTickRunning = false;

        canvas.addEventListener('touchmove', (evt) => {
            if (!AppState.getLoadedMapImg() || !AppState.getPanLocation() || evt.touches.length === 0) return;
            evt.preventDefault();

            if (isTouchTickRunning) return;

            isTouchTickRunning = true;
            requestAnimationFrame(() => {
                handleTouchMoveLogic(evt);
                isTouchTickRunning = false;
            });
        }, { passive: false });

        function handleTouchMoveLogic(evt) {
            const pinch = AppState.getPinch();

            // pinch logic
            if (evt.touches.length >= 2 && pinch.active) {
                AppState.setSuppressNextTap(true);
                const [t1, t2] = [evt.touches[0], evt.touches[1]];
                const dist = Utils.distanceBetweenTouches(t1, t2);
                const scale = dist / (pinch.startDist || dist);
                const deltaZoom = Math.log(scale) / Math.log(AppState.ZOOM_BASE);
                const mid = Utils.midpointBetweenTouches(t1, t2);
                Renderer.setZoomAbsolute(pinch.startZoom + deltaZoom, mid.x, mid.y);
                return;
            }

            // single finger logic
            if (evt.touches.length === 1 && AppState.getIsTouching() && AppState.getTouchStartedInside()) {
                const { x, y } = Utils.getOffsetFromTouch(evt.touches[0]);
                canvas.mouseX = x;
                canvas.mouseY = y;

                const mouseMode = AppState.getMouseMode();

                if (mouseMode === 2) {
                    const selectedDot = AppState.getSelectedDot();
                    if (selectedDot) {
                        const fakeEvt = { offsetX: x, offsetY: y };
                        selectedDot.long = Utils.mouseLong(fakeEvt);
                        selectedDot.lat = Utils.mouseLat(fakeEvt);
                        AppState.setNeedsIndexRebuild(true);
                        Renderer.requestRedraw();
                    }
                    AppState.setTouchLastX(x);
                    AppState.setTouchLastY(y);
                    return;
                }

                const beginClickX = AppState.getBeginClickX();
                const beginClickY = AppState.getBeginClickY();
                const dist = Math.hypot(x - beginClickX, y - beginClickY);

                if (mouseMode === 1 || dist >= DRAG_THRESHOLD) {
                    AppState.setMouseMode(1);
                    updatePanPosition(x, y, beginClickX, beginClickY);
                    Renderer.requestRedraw();
                }

                AppState.setTouchLastX(x);
                AppState.setTouchLastY(y);
            }
        }

        canvas.addEventListener('touchend', (evt) => {
            if (!AppState.getLoadedMapImg() || !AppState.getPanLocation()) return;
            evt.preventDefault();

            const pinch = AppState.getPinch();
            // if a pinch was active and fewer than two touches remain, stop pinching
            if (evt.touches.length < 2 && pinch.active) pinch.active = false;

            const isLastFinger = evt.touches.length === 0;

            // if a pinch/multi-touch occurred during this gesture, suppress any tap actions on last finger up
            if (isLastFinger && AppState.getSuppressNextTap()) {
                AppState.setSuppressNextTap(false);
                resetInteractionState();
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

            const mouseMode = AppState.getMouseMode();
            const fakeEvt = { offsetX: touchLastX, offsetY: touchLastY };

            if (mouseMode === 0 && moved < DRAG_THRESHOLD) {
                const radius = Math.pow(AppState.ZOOM_BASE, AppState.getZoomAmt());
                const nearest = pickNearestPoint(touchLastX, touchLastY, radius);
                if (nearest) {
                    AppState.setHoverTrack(nearest.track);
                    AppState.setHoverDot(nearest.point);
                } else {
                    AppState.setHoverTrack(undefined);
                    AppState.setHoverDot(undefined);
                }
                handleAddPoint(fakeEvt);
            } else if (mouseMode === 2) {
                handleMovePoint(fakeEvt);
            } else if (mouseMode === 3) {
                handleDeletePoint(fakeEvt);
            }

            resetInteractionState();
            Renderer.requestRedraw();
        }, { passive: false });

        canvas.addEventListener('touchcancel', (evt) => {
            evt.preventDefault();
            AppState.getPinch().active = false;
            AppState.setSuppressNextTap(false);
            resetInteractionState();
        }, { passive: false });
    }

    function updatePanPosition(currX, currY, startX, startY) {
        const panLocation = AppState.getPanLocation();
        if (AppState.getBeginPanX() === undefined) AppState.setBeginPanX(panLocation.long);
        if (AppState.getBeginPanY() === undefined) AppState.setBeginPanY(panLocation.lat);

        const mvw = Utils.mapViewWidth();
        const mvh = Utils.mapViewHeight();
        const beginPanX = AppState.getBeginPanX();
        const beginPanY = AppState.getBeginPanY();

        panLocation.long = Utils.normalizeLongitude(beginPanX - mvw * (currX - startX) / AppState.WIDTH);
        panLocation.lat = Utils.constrainLatitude(beginPanY + mvh * (currY - startY) / (AppState.WIDTH / 2), mvh);
    }

    function resetInteractionState() {
        AppState.setIsDragging(false);
        AppState.setIsTouching(false);
        AppState.setBeginClickX(undefined);
        AppState.setBeginClickY(undefined);
        AppState.setBeginPanX(undefined);
        AppState.setBeginPanY(undefined);

        const refreshGUI = AppState.getRefreshGUI();
        if (refreshGUI) refreshGUI();
        Renderer.requestRedraw();
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
        if (!selectedDot) return;

        selectedDot.long = Utils.mouseLong(evt);
        selectedDot.lat = Utils.mouseLat(evt);

        AppState.setNeedsIndexRebuild(true);

        const selectedTrack = AppState.getSelectedTrack();
        const tracks = AppState.getTracks();
        const trackIndex = tracks.indexOf(selectedTrack);

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
        const searchRadius = Math.pow(AppState.ZOOM_BASE, AppState.getZoomAmt());

        // check dirty flag internally and rebuild only if needed
        const nearest = pickNearestPoint(evt.offsetX, evt.offsetY, searchRadius);

        if (nearest) {
            const tracks = AppState.getTracks();
            const trackIndex = tracks.indexOf(nearest.track);
            const pointIndex = nearest.track.indexOf(nearest.point);

            if (trackIndex !== -1 && pointIndex !== -1) {
                handlePointDeletion(trackIndex, pointIndex, nearest.point);
                AppState.setNeedsIndexRebuild(true);
                if (AppState.getAutosave()) {
                    tracks.length === 0 ? Database.delete() : Database.save();
                }
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
            // select previous, or next if 0
            const newIndex = Math.max(0, pointIndex - 1);
            if (track[newIndex]) AppState.setSelectedDot(track[newIndex]);
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
