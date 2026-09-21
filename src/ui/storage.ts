const PREFIX = 'diffshub-for-github.';

export function readSetting(key: string, fallback: string): string {
    try {
        return localStorage.getItem(PREFIX + key) ?? fallback;
    } catch {
        return fallback;
    }
}

export function writeSetting(key: string, value: string): void {
    try {
        localStorage.setItem(PREFIX + key, value);
    } catch {
        // A blocked storage partition is not worth failing the overlay over.
    }
}
