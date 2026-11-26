import { chromium } from 'playwright';

// Chromium for every browser check, from the executable CI pins when it sets one.
export function launchChromium(options = {}) {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    return chromium.launch({ ...options, ...(executablePath ? { executablePath } : {}) });
}
