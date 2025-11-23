// import and export functionality for HURDAT and JSON formats

const ImportExport = (() => {
    
    // HURDAT export helpers
    const HURDAT_FORMATS = {
        HEADER: (id, count) => `${id},                STORMNAME,     ${count},\n`,
        ENTRY: (year, month, day, time, type, lat, lon, wind, pressure) =>
            `${year}${month}${day}, ${time},  , ${type}, ${lat}, ${lon}, ${wind}, ${pressure},\n`
    };
    
    const TYPE_CODES = { EX: 'EX', SD: 'SD', SS: 'SS', TD: 'TD', TS: 'TS', HU: 'HU' };
    
    const STAGE_NAMES = {
        EX: 'Extratropical cyclone', SD: 'Subtropical cyclone', SS: 'Subtropical cyclone',
        TD: 'Tropical cyclone', TS: 'Tropical cyclone', HU: 'Tropical cyclone'
    };

    function getTypeCode(point) {
        const wind = getWindSpeed(point);
        const { type } = point;
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

    function getWindSpeed(point) {
        if (point.wind !== null && !isNaN(point.wind)) {
            return point.wind;
        }
        const masterCategories = AppState.getMasterCategories();
        return masterCategories[point.cat]?.speed || 0;
    }

    function getPressure(point) {
        if (point.pressure !== null && !isNaN(point.pressure)) {
            return point.pressure;
        }
        const masterCategories = AppState.getMasterCategories();
        return masterCategories[point.cat]?.pressure || 1015;
    }

    function getStageName(point) {
        return STAGE_NAMES[getTypeCode(point)];
    }

    function exportHURDAT(decimalPlaces = 1) {
        const parts = [];
        const compatibilityMode = document.getElementById('compatibility-mode-checkbox')?.checked || false;
        const tracks = AppState.getTracks();

        tracks.forEach((track, index) => {
            if (track.length === 0) return;

            const stormId = 'MT' + Utils.padNumber(index + 1, 2) + (track.startDate ? track.startDate.substring(0, 4) : new Date().getFullYear());
            let header = HURDAT_FORMATS.HEADER(stormId, track.length);
            const stormName = (track.name || 'STORMNAME').substring(0, 27).padEnd(9);
            header = header.replace('STORMNAME', stormName);

            const entries = track.map((point, i) => {
                let year, month, day, timeOfDay;

                if (track.startDate && /^\d{8}$/.test(track.startDate) && track.startTime !== undefined) {
                    const startYear = parseInt(track.startDate.substring(0, 4), 10);
                    const startMonth = parseInt(track.startDate.substring(4, 6), 10) - 1; // JS months are 0-indexed
                    const startDay = parseInt(track.startDate.substring(6, 8), 10);
                    const startHour = track.startTime;

                    const pointDate = new Date(Date.UTC(startYear, startMonth, startDay, startHour));
                    pointDate.setUTCHours(pointDate.getUTCHours() + i * 6);

                    year = pointDate.getUTCFullYear();
                    month = pointDate.getUTCMonth() + 1;
                    day = pointDate.getUTCDate();
                    timeOfDay = Utils.padNumber(pointDate.getUTCHours() * 100, 4);
                } else {
                    // fallback for tracks without a start date
                    const currentYear = new Date().getFullYear();
                    const dayOfYear = Math.floor(i / 4) + 1;
                    const tempDate = new Date(Date.UTC(currentYear, 0, dayOfYear));
                    year = currentYear;
                    month = tempDate.getUTCMonth() + 1;
                    day = tempDate.getUTCDate();
                    timeOfDay = Utils.padNumber((i % 4) * 600, 4);
                }

                let entry = HURDAT_FORMATS.ENTRY(
                    year,
                    Utils.padNumber(month, 2),
                    Utils.padNumber(day, 2),
                    timeOfDay,
                    getTypeCode(point),
                    Utils.formatLatLon(point.lat, true, decimalPlaces).padStart(5),
                    Utils.formatLatLon(point.long, false, decimalPlaces).padStart(6),
                    String(getWindSpeed(point)).padStart(3),
                    getPressure(point)
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

    function exportJSON(decimalPlaces = 1) {
        const result = { tracks: [] };
        const tracks = AppState.getTracks();
        const masterCategories = AppState.getMasterCategories();
        
        tracks.forEach((track, trackIndex) => {
            if (track.length === 0) return;
            const stormName = track.name || `STORM ${trackIndex + 1}`;
            result.tracks.push(track.map(point => ({
                name: stormName,
                latitude: Utils.formatLatLon(point.lat, true, decimalPlaces),
                longitude: Utils.formatLatLon(point.long, false, decimalPlaces),
                speed: getWindSpeed(point),
                pressure: getPressure(point),
                category: masterCategories[point.cat]?.name || 'Unknown',
                stage: getStageName(point)
            })));
        });
        return result;
    }

    function importJSONFile(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const json = JSON.parse(reader.result);
                let tracksData = [];
                const masterCategories = AppState.getMasterCategories();

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

                const tracks = tracksData.map(trackData => {
                    const newTrack = trackData.map(pointData => {
                        let cat = -1;
                        // first, try to match by category name
                        if (pointData.category) {
                            cat = masterCategories.findIndex(c => c.name === pointData.category);
                        }
                        // if not found, fall back to matching by speed
                        if (cat === -1 && pointData.speed !== undefined) {
                            let closestSpeedCat = -1;
                            let smallestDiff = Infinity;
                            Models.DEFAULT_CATEGORIES.forEach((c, index) => {
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

                        return new Models.TrackPoint(
                            Utils.parseCoordinate(pointData.longitude),
                            Utils.parseCoordinate(pointData.latitude),
                            cat,
                            type,
                            pointData.speed,
                            pointData.pressure
                        );
                    });
                    // assign name to the track array itself
                    if (trackData.length > 0 && trackData[0].name) {
                        newTrack.name = trackData[0].name;
                    }
                    return newTrack;
                });

                AppState.setTracks(tracks);
                Database.save();
                History.reset();
                Utils.deselectTrack();
                const refreshGUI = AppState.getRefreshGUI();
                if (refreshGUI) refreshGUI();
            } catch (error) {
                alert('Error importing JSON: ' + error.message);
            }
        };
        reader.readAsText(file);
    }

    function importHURDATFile(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const lines = reader.result.split('\n');
                const tracks = [];
                let currentTrack = null;
                const masterCategories = AppState.getMasterCategories();

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;

                    const parts = line.split(',').map(p => p.trim());

                    // check if this is a header line (storm ID line)
                    if (parts.length >= 3 && parts[0].length <= 8 && !parts[0].includes(' ')) {
                        // this is a header line
                        if (currentTrack && currentTrack.length > 0) {
                            tracks.push(currentTrack);
                        }
                        currentTrack = [];
                        
                        // extract storm name from header
                        const stormName = parts[1];
                        if (stormName && stormName !== 'STORMNAME') {
                            currentTrack.name = stormName;
                        }
                        
                        // extract start date from first entry (next line)
                        if (i + 1 < lines.length) {
                            const nextLine = lines[i + 1].trim();
                            const nextParts = nextLine.split(',').map(p => p.trim());
                            if (nextParts.length >= 2 && nextParts[0].length === 8) {
                                currentTrack.startDate = nextParts[0];
                                const timeStr = nextParts[1];
                                currentTrack.startTime = parseInt(timeStr.substring(0, 2), 10);
                            }
                        }
                        continue;
                    }

                    // this should be a data line
                    if (parts.length < 7 || !currentTrack) continue;

                    // parse data: DATE, TIME, unused, TYPE, LAT, LON, WIND, PRESSURE
                    const typeCode = parts[3];
                    const latStr = parts[4];
                    const lonStr = parts[5];
                    const windStr = parts[6];
                    const pressureStr = parts.length >= 8 ? parts[7] : '1015';

                    // parse latitude and longitude
                    const lat = Utils.parseCoordinate(latStr);
                    const lon = Utils.parseCoordinate(lonStr);
                    const wind = parseInt(windStr, 10) || 0;
                    const pressure = parseInt(pressureStr, 10) || 1015;

                    // determine type based on type code
                    let type = 0; // tropical by default
                    if (typeCode === 'EX') type = 2; // extratropical
                    else if (typeCode === 'SD' || typeCode === 'SS') type = 1; // subtropical

                    // find category based on wind speed
                    let cat = 0;
                    for (let j = Models.DEFAULT_CATEGORIES.length - 1; j >= 0; j--) {
                        if (wind >= Models.DEFAULT_CATEGORIES[j].speed) {
                            cat = j;
                            break;
                        }
                    }

                    const point = new Models.TrackPoint(lon, lat, cat, type, wind, pressure);
                    currentTrack.push(point);
                }

                // add the last track
                if (currentTrack && currentTrack.length > 0) {
                    tracks.push(currentTrack);
                }

                if (tracks.length === 0) {
                    alert('No valid tracks found in HURDAT file.');
                    return;
                }

                AppState.setTracks(tracks);
                Database.save();
                History.reset();
                Utils.deselectTrack();
                const refreshGUI = AppState.getRefreshGUI();
                if (refreshGUI) refreshGUI();
                
                alert(`Successfully imported ${tracks.length} track(s).`);
            } catch (error) {
                alert('Error importing HURDAT file: ' + error.message);
                console.error('HURDAT import error:', error);
            }
        };
        reader.readAsText(file);
    }

    return {
        exportHURDAT,
        exportJSON,
        importJSONFile,
        importHURDATFile,
        getWindSpeed,
        getPressure,
        getStageName
    };
})();
