// ConeGen?
const ConeGen = (() => {
    
    function convertWind(val, from, to) {
        if (val === null || val === undefined) return 0;
        let mph;
        if (from === 'mph') mph = val;
        else if (from === 'kph') mph = val / 1.60934;
        else if (from === 'kt') mph = val * 1.15078;
        
        let result;
        if (to === 'mph') result = mph;
        else if (to === 'kph') result = mph * 1.60934;
        else if (to === 'kt') result = mph / 1.15078;
        
        return Math.round(result / 5) * 5;
    }

    function cascadeDateTime(track) {
        if (!track || track.length < 1) return;
        
        const interval = AppState.getConeTimeInterval();
        const startPoint = track[0];
        
        // base start point
        if (!startPoint.date || startPoint.time === undefined) return;
        
        let year = parseInt(startPoint.date.substring(0, 4));
        let month = parseInt(startPoint.date.substring(4, 6)) - 1;
        let day = parseInt(startPoint.date.substring(6, 8));
        let hour = parseInt(startPoint.time);
        
        let startObj = new Date(Date.UTC(year, month, day, hour, 0, 0));
        
        for(let i = 1; i < track.length; i++) {
            let nextDate = new Date(startObj.getTime() + (i * interval * 60 * 60 * 1000));
            
            const Y = nextDate.getUTCFullYear();
            const M = String(nextDate.getUTCMonth() + 1).padStart(2, '0');
            const D = String(nextDate.getUTCDate()).padStart(2, '0');
            const H = nextDate.getUTCHours();
            
            track[i].date = `${Y}${M}${D}`;
            track[i].time = H;
        }
    }

    function hexToRgba(hex, alpha) {
        let r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function getPerpAngle(points, i) {
        if (points.length < 2) return 0;
        let pPrev = points[Math.max(0, i - 1)];
        let pNext = points[Math.min(points.length - 1, i + 1)];
        return Math.atan2(pNext.y - pPrev.y, pNext.x - pPrev.x);
    }

    return {
        convertWind,
        cascadeDateTime,
        hexToRgba,
        getPerpAngle
    };
})();
