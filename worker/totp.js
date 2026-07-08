/**
 * TOTP (Time-based One-Time Password) implementation
 * Uses Web Crypto API (available in Cloudflare Workers)
 */

const TOTP_PERIOD = 30; // seconds
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = 'SHA-1';

/**
 * Generate a random base32 secret for TOTP
 */
export function generateSecret(length = 20) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, b => chars[b % 32]).join('');
}

/**
 * Decode base32 string to Uint8Array
 */
function base32Decode(input) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const cleaned = input.replace(/[^A-Z2-7]/gi, '').toUpperCase();
    let bits = '';
    for (const char of cleaned) {
        const val = chars.indexOf(char);
        if (val === -1) continue;
        bits += val.toString(2).padStart(5, '0');
    }
    const bytes = new Uint8Array(Math.floor(bits.length / 8));
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(bits.substr(i * 8, 8), 2);
    }
    return bytes;
}

/**
 * Generate TOTP code for a given time step
 */
async function generateCode(secret, timeStep) {
    const key = base32Decode(secret);
    const timeBuffer = new ArrayBuffer(8);
    const timeView = new DataView(timeBuffer);
    timeView.setUint32(4, timeStep, false);

    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key,
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, timeBuffer);
    const hash = new Uint8Array(signature);

    const offset = hash[hash.length - 1] & 0x0f;
    const code = (
        ((hash[offset] & 0x7f) << 24) |
        ((hash[offset + 1] & 0xff) << 16) |
        ((hash[offset + 2] & 0xff) << 8) |
        (hash[offset + 3] & 0xff)
    ) % Math.pow(10, TOTP_DIGITS);

    return code.toString().padStart(TOTP_DIGITS, '0');
}

/**
 * Verify a TOTP code
 * Checks current time step and adjacent windows for clock skew
 */
export async function verify(secret, token, window = 1) {
    const now = Math.floor(Date.now() / 1000);
    const currentStep = Math.floor(now / TOTP_PERIOD);

    for (let i = -window; i <= window; i++) {
        const expected = await generateCode(secret, currentStep + i);
        if (expected === token) {
            return true;
        }
    }
    return false;
}

/**
 * Generate otpauth:// URI for QR code
 */
export function generateURI(secret, issuer = 'Kanamiisa', account = 'kanamiisa') {
    const encodedIssuer = encodeURIComponent(issuer);
    const encodedAccount = encodeURIComponent(account);
    return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}
