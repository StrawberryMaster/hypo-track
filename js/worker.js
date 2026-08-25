self.onmessage = async function ({ data: { paths } }) {
    try {
        const imgs = await Promise.all(
            paths.map(async (path) => {
                const response = await fetch(path);
                if (!response.ok) {
                    throw new Error(`Failed to fetch ${path}: ${response.statusText}`);
                }
                return response.arrayBuffer();
            })
        );
        self.postMessage({ imgs }, imgs);
    } catch (error) {
        self.postMessage({ error: error.message });
    }
};