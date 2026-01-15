const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export const generateUserId = () => Array.from({ length: 6 }, () => CHARS.charAt(Math.floor(Math.random() * CHARS.length))).join('');

export const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

export const generateToken = (length = 32) => Array.from({ length }, () => CHARS.charAt(Math.floor(Math.random() * CHARS.length))).join('');
