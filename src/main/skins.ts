import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const GROM_DIR = path.join(os.homedir(), '.gromclient');

function httpsDownload(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 404) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        reject(new Error('Скин не найден на Ely.by'));
        return;
      }
      if (res.statusCode === 302 && res.headers.location) {
        https.get(res.headers.location, (res2) => {
          res2.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
      } else {
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }
    }).on('error', reject);
  });
}

export async function downloadElySkin(nickname: string): Promise<string> {
  if (!/^[A-Za-z0-9_]{1,16}$/.test(nickname)) throw new Error('Ник должен содержать только латинские буквы, цифры и подчёркивание (до 16 символов).');
  const safeNickname = nickname;
  const url = `https://skinsystem.ely.by/skins/${encodeURIComponent(safeNickname)}.png`;
  const dest = path.join(GROM_DIR, 'skins', `${safeNickname}.png`);
  await httpsDownload(url, dest);
  return dest;
}

export async function downloadElyCape(nickname: string): Promise<string> {
  if (!/^[A-Za-z0-9_]{1,16}$/.test(nickname)) throw new Error('Ник должен содержать только латинские буквы, цифры и подчёркивание (до 16 символов).');
  const safeNickname = nickname;
  const url = `https://skinsystem.ely.by/cloaks/${encodeURIComponent(safeNickname)}.png`;
  const dest = path.join(GROM_DIR, 'capes', `${safeNickname}.png`);
  await httpsDownload(url, dest);
  return dest;
}

export function getElySkinUrl(nickname: string): string {
  if (!/^[A-Za-z0-9_]{1,16}$/.test(nickname)) throw new Error('Некорректный ник.');
  return `https://skinsystem.ely.by/skins/${encodeURIComponent(nickname)}.png`;
}

export function getElyCapeUrl(nickname: string): string {
  if (!/^[A-Za-z0-9_]{1,16}$/.test(nickname)) throw new Error('Некорректный ник.');
  return `https://skinsystem.ely.by/cloaks/${encodeURIComponent(nickname)}.png`;
}