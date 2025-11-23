// spatial indexing utilities
const Spatial = (() => {
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
                this.children = null;
                this.divided = false;
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

    return {
        QuadTree,
        CircleRange
    };
})();
