// spatial indexing utilities
const Spatial = (() => {
    
    const MAX_DEPTH = 8;
    const CAPACITY = 16;

    class QuadTree {
        constructor(bounds, depth = 0) {
            this.bounds = bounds; // {x, y, width, height}
            this.depth = depth;
            this.points = [];
            this.divided = false;
            
            // pre-allocate properties to avoid hidden class changes
            this.nw = null;
            this.ne = null;
            this.sw = null;
            this.se = null;
        }

        subdivide() {
            // reuse existing child objects if they exist
            if (this.nw) {
                this.divided = true;
                this.distribute();
                return;
            }

            const x = this.bounds.x;
            const y = this.bounds.y;
            const w = this.bounds.width / 2;
            const h = this.bounds.height / 2;
            const nextDepth = this.depth + 1;

            this.nw = new QuadTree({ x: x, y: y, width: w, height: h }, nextDepth);
            this.ne = new QuadTree({ x: x + w, y: y, width: w, height: h }, nextDepth);
            this.sw = new QuadTree({ x: x, y: y + h, width: w, height: h }, nextDepth);
            this.se = new QuadTree({ x: x + w, y: y + h, width: w, height: h }, nextDepth);

            this.divided = true;
            this.distribute();
        }

        distribute() {
            for (let i = 0; i < this.points.length; i++) {
                this.insertToChild(this.points[i]);
            }
            this.points.length = 0;
        }

        // determine quadrant
        getChildIndex(point) {
            const midX = this.bounds.x + (this.bounds.width / 2);
            const midY = this.bounds.y + (this.bounds.height / 2);
            
            const isNorth = point.screenY < midY;
            const isWest = point.screenX < midX;

            if (isNorth) return isWest ? 0 : 1; // 0: NW, 1: NE
            return isWest ? 2 : 3;              // 2: SW, 3: SE
        }

        insertToChild(point) {
            const index = this.getChildIndex(point);
            if (index === 0) this.nw.insert(point);
            else if (index === 1) this.ne.insert(point);
            else if (index === 2) this.sw.insert(point);
            else if (index === 3) this.se.insert(point);
        }

        insert(point) {
            // check bounds only at the root or if absolutely necessary
            if (this.depth === 0 && !this.contains(point)) return false;

            if (!this.divided) {
                if (this.points.length < CAPACITY || this.depth >= MAX_DEPTH) {
                    this.points.push(point);
                    return true;
                }
                this.subdivide();
            }

            this.insertToChild(point);
            return true;
        }

        query(range, found = []) {
            if (!this.intersects(range)) return found;

            // check points in this node
            for (let i = 0; i < this.points.length; i++) {
                if (range.contains(this.points[i])) {
                    found.push(this.points[i]);
                }
            }

            // recurse if divided
            if (this.divided) {
                this.nw.query(range, found);
                this.ne.query(range, found);
                this.sw.query(range, found);
                this.se.query(range, found);
            }

            return found;
        }

        clear() {
            this.points.length = 0;
            this.divided = false;
            
            // recursively reset children, but keep objects in memory
            if (this.nw) {
                this.nw.clear();
                this.ne.clear();
                this.sw.clear();
                this.se.clear();
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

    class CircleRange {
        constructor(x, y, radius) {
            this.centerX = x;
            this.centerY = y;
            this.radius = radius;
            this.radiusSq = radius * radius;
            
            this.x = x - radius;
            this.y = y - radius;
            this.width = radius * 2;
            this.height = radius * 2;
        }

        contains(point) {
            const dx = point.screenX - this.centerX;
            const dy = point.screenY - this.centerY;
            return (dx * dx + dy * dy) <= this.radiusSq;
        }
    }

    return {
        QuadTree,
        CircleRange
    };
})();
