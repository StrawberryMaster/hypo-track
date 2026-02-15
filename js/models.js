// data models and constants

const Models = (() => {
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

    class TrackPoint {
        constructor(long, lat, cat, type, wind, pressure, date, time) {
            this.long = long || 0;
            this.lat = lat || 0;
            this.cat = cat || 0;
            this.type = type || 0;
            this.wind = (wind !== undefined && wind !== null && !isNaN(wind)) ? Number(wind) : null;
            this.pressure = (pressure !== undefined && pressure !== null && !isNaN(pressure)) ? Number(pressure) : null;
            this.date = date || null; // YYYYMMDD
            this.time = time !== undefined ? time : null; // HH
        }
    }

    return {
        DEFAULT_CATEGORIES,
        TrackPoint
    };
})();
