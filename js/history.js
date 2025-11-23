// history management for undo/redo operations

const History = (() => {
    let undoItems = [];
    let redoItems = [];

    const ActionTypes = {
        addPoint: 0,
        movePoint: 1,
        modifyPoint: 2,
        deletePoint: 3,
        setTrackDate: 4,
        setTrackName: 5
    };

    function undo() {
        if (!canUndo()) return;
        const action = undoItems.pop();
        const t = action.actionType;
        const d = action.data;
        const tracks = AppState.getTracks();
        let selectedDot = AppState.getSelectedDot();
        let selectedTrack = AppState.getSelectedTrack();

        if (t === ActionTypes.addPoint) {
            const track = tracks[d.trackIndex];
            const point = track[d.pointIndex];
            track.splice(d.pointIndex, 1);
            if (point === selectedDot && track.length > 0) {
                selectedDot = track[track.length - 1];
                AppState.setSelectedDot(selectedDot);
            }
            if (track.length < 1) {
                tracks.splice(d.trackIndex, 1);
                if (track === selectedTrack) {
                    Utils.deselectTrack();
                }
            }
        } else if (t === ActionTypes.movePoint) {
            const point = tracks[d.trackIndex][d.pointIndex];
            point.long = d.long0;
            point.lat = d.lat0;
        } else if (t === ActionTypes.modifyPoint) {
            const point = tracks[d.trackIndex][d.pointIndex];
            point.cat = d.oldCat;
            point.type = d.oldType;
            point.wind = d.oldWind;
            point.pressure = d.oldPressure;
        } else if (t === ActionTypes.deletePoint) {
            let track;
            if (d.trackDeleted) {
                track = [];
                tracks.splice(d.trackIndex, 0, track);
            } else track = tracks[d.trackIndex];
            const point = new Models.TrackPoint(d.long, d.lat, d.cat, d.type, d.wind, d.pressure);
            track.splice(d.pointIndex, 0, point);
        } else if (t === ActionTypes.setTrackDate) {
            const track = tracks[d.trackIndex];
            track.startDate = d.oldStartDate;
            track.startTime = d.oldStartTime;
        } else if (t === ActionTypes.setTrackName) {
            const track = tracks[d.trackIndex];
            track.name = d.oldName;
        }

        redoItems.push(action);
        const autosave = AppState.getAutosave();
        if (autosave) tracks.length === 0 ? Database.delete() : Database.save();

        // mark spatial index for rebuild
        AppState.setNeedsIndexRebuild(true);

        Renderer.requestRedraw();
    }

    function redo() {
        if (!canRedo()) return;
        const action = redoItems.pop();
        const t = action.actionType;
        const d = action.data;
        const tracks = AppState.getTracks();
        let selectedDot = AppState.getSelectedDot();
        let selectedTrack = AppState.getSelectedTrack();

        if (t === ActionTypes.addPoint) {
            let track;
            if (d.newTrack) {
                track = [];
                tracks.push(track);
            } else track = tracks[d.trackIndex];
            const point = new Models.TrackPoint(d.long, d.lat, d.cat, d.type);
            track.splice(d.pointIndex, 0, point);
        } else if (t === ActionTypes.movePoint) {
            const point = tracks[d.trackIndex][d.pointIndex];
            point.long = d.long1;
            point.lat = d.lat1;
        } else if (t === ActionTypes.modifyPoint) {
            const point = tracks[d.trackIndex][d.pointIndex];
            point.cat = d.newCat;
            point.type = d.newType;
            point.wind = d.newWind;
            point.pressure = d.newPressure;
        } else if (t === ActionTypes.deletePoint) {
            const track = tracks[d.trackIndex];
            const point = track[d.pointIndex];
            track.splice(d.pointIndex, 1);
            if (point === selectedDot && track.length > 0) {
                selectedDot = track[track.length - 1];
                AppState.setSelectedDot(selectedDot);
            }
            if (track.length < 1) {
                tracks.splice(d.trackIndex, 1);
                if (track === selectedTrack) {
                    Utils.deselectTrack();
                }
            }
        } else if (t === ActionTypes.setTrackDate) {
            const track = tracks[d.trackIndex];
            track.startDate = d.newStartDate;
            track.startTime = d.newStartTime;
        } else if (t === ActionTypes.setTrackName) {
            const track = tracks[d.trackIndex];
            track.name = d.newName;
        }

        undoItems.push(action);
        const autosave = AppState.getAutosave();
        if (autosave) tracks.length === 0 ? Database.delete() : Database.save();

        // mark spatial index for rebuild
        AppState.setNeedsIndexRebuild(true);

        Renderer.requestRedraw();
    }

    function record(actionType, data) {
        undoItems.push({ actionType, data });
        redoItems = [];
        Renderer.requestRedraw();
    }

    function reset() {
        undoItems = [];
        redoItems = [];
        Renderer.requestRedraw();
    }

    function canUndo() {
        return undoItems.length > 0;
    }

    function canRedo() {
        return redoItems.length > 0;
    }

    return { undo, redo, record, reset, ActionTypes, canUndo, canRedo };
})();
