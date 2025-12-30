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
                const text = reader.result;
                const lines = text.split(/\r?\n/).map(l => l.replace(/\u00A0/g, ' ').trim()).filter(l => l.length > 0);
                const headerRe = /^([A-Z]{2}\d{6}),\s*([^,]{0,12}?),\s*(\d+),/i;

                let importedTracks = [];
                let currentTrack = [];
                let stormName = '';
                let firstDate = null;
                let firstTime = null;

                const mapTypeCode = (code) => {
                    if (!code) return 0;
                    const c = code.trim().toUpperCase();
                    if (c === 'EX') return 2;
                    if (c === 'SD' || c === 'SS') return 1;
                    return 0;
                };

                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    // header
                    const h = line.match(headerRe);
                    if (h) {
                        if (currentTrack.length > 0) {
                            currentTrack.startDate = firstDate || '';
                            currentTrack.startTime = firstTime !== null ? firstTime : undefined;
                            currentTrack.name = stormName || '';
                            importedTracks.push(currentTrack);
                            currentTrack = [];
                        }
                        // preserve storm name where provided; ignore placeholder STORMNAME
                        stormName = (h[2] || '').trim();
                        if (stormName.toUpperCase().includes('STORMNAME')) stormName = '';
                        firstDate = null;
                        firstTime = null;
                        continue;
                    }

                    // attempt to parse entry by splitting on commas
                    const parts = line.split(',').map(p => p.trim());
                    if (parts.length < 4) continue;

                    // detect date/time at start
                    const datePart = parts[0];
                    const timePart = parts[1];
                    if (!/^\d{8}$/.test(datePart) || !/^\d{4}$/.test(timePart)) continue;

                    const typeCode = (parts[3] || '').toUpperCase();
                    const latRaw = (parts[4] || '').replace(/\s+/g, '');
                    const lonRaw = (parts[5] || '').replace(/\s+/g, '');
                    const windRaw = (parts[6] || '').replace(/\s+/g, '');
                    const presRaw = (parts[7] || '').replace(/\s+/g, '');

                    if (!firstDate) firstDate = datePart;
                    if (firstTime === null) {
                        const tnum = parseInt(timePart, 10);
                        firstTime = isNaN(tnum) ? undefined : Math.floor(tnum / 100);
                    }

                    // parse lat
                    let lat = null, lon = null;
                    let m = latRaw.match(/^([0-9.+-]+)\s*([NS])$/i) || latRaw.match(/^([NS])\s*([0-9.+-]+)$/i);
                    if (m) {
                        if (m[2] && /[NS]/i.test(m[2])) {
                            lat = parseFloat(m[1]) * (m[2].toUpperCase() === 'S' ? -1 : 1);
                        } else if (m[1] && /[NS]/i.test(m[1])) {
                            lat = parseFloat(m[2]) * (m[1].toUpperCase() === 'S' ? -1 : 1);
                        }
                    } else {
                        const t = latRaw.replace(/[^0-9.\-NSns]/g, '');
                        const last = t.slice(-1).toUpperCase();
                        const num = parseFloat(t.slice(0, -1));
                        if (!isNaN(num) && (last === 'N' || last === 'S')) lat = num * (last === 'S' ? -1 : 1);
                    }

                    // parse lon
                    m = lonRaw.match(/^([0-9.+-]+)\s*([EW])$/i) || lonRaw.match(/^([EW])\s*([0-9.+-]+)$/i);
                    if (m) {
                        if (m[2] && /[EW]/i.test(m[2])) {
                            lon = parseFloat(m[1]) * (m[2].toUpperCase() === 'W' ? -1 : 1);
                        } else if (m[1] && /[EW]/i.test(m[1])) {
                            lon = parseFloat(m[2]) * (m[1].toUpperCase() === 'W' ? -1 : 1);
                        }
                    } else {
                        const t = lonRaw.replace(/[^0-9.\-EWew]/g, '');
                        const last = t.slice(-1).toUpperCase();
                        const num = parseFloat(t.slice(0, -1));
                        if (!isNaN(num) && (last === 'E' || last === 'W')) lon = num * (last === 'W' ? -1 : 1);
                    }

                    // parse wind/pressure - treat non-numeric or -999/-99 as null
                    const wind = (windRaw === '' || windRaw === '-999' || windRaw === '-99') ? null : (isNaN(parseInt(windRaw, 10)) ? null : parseInt(windRaw, 10));
                    const pressure = (presRaw === '' || presRaw === '-999' || presRaw === '-99') ? null : (isNaN(parseInt(presRaw, 10)) ? null : parseInt(presRaw, 10));

                    if (lat !== null && lon !== null) {
                        const ptType = mapTypeCode(typeCode);
                        const determineCategoryIndex = (windVal) => {
                            const masterCategories = AppState.getMasterCategories();
                            if (windVal === null || windVal === undefined || isNaN(windVal)) {
                                let unknownIdx = masterCategories.findIndex(c => c.name && c.name.toLowerCase() === 'unknown');
                                return unknownIdx !== -1 ? unknownIdx : masterCategories.length - 1;
                            }
                            let bestIdx = null;
                            let bestSpeed = -Infinity;
                            for (let ci = 0; ci < masterCategories.length; ci++) {
                                const s = Number(masterCategories[ci].speed || 0);
                                if (!isNaN(s) && s <= windVal && s > bestSpeed) {
                                    bestSpeed = s;
                                    bestIdx = ci;
                                }
                            }
                            if (bestIdx !== null) return bestIdx;
                            // pick category with minimum speed
                            let minIdx = 0;
                            let minSpeed = Number(masterCategories[0].speed || 0);
                            for (let ci = 1; ci < masterCategories.length; ci++) {
                                const s = Number(masterCategories[ci].speed || 0);
                                if (s < minSpeed) { minSpeed = s; minIdx = ci; }
                            }
                            return minIdx;
                        };

                        const catIndex = determineCategoryIndex(wind);
                        const point = new Models.TrackPoint(lon, lat, catIndex, ptType, wind, pressure);
                        currentTrack.push(point);
                    }
                }

                // finalize last track if any
                if (currentTrack.length > 0) {
                    currentTrack.startDate = firstDate || '';
                    currentTrack.startTime = firstTime !== null ? firstTime : undefined;
                    currentTrack.name = stormName || '';
                    importedTracks.push(currentTrack);
                }

                if (importedTracks.length === 0) {
                    alert('No valid HURDAT data found.');
                    return;
                }

                AppState.setTracks(importedTracks);
                Database.save();
                History.reset();
                Utils.deselectTrack();
                const refreshGUI = AppState.getRefreshGUI();
                if (refreshGUI) refreshGUI();

                alert(`Successfully imported ${importedTracks.length} track(s).`);
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
