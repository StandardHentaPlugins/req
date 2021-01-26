import {promises as fs } from 'fs';
import ReqPlugin from '.';

export default class FileLoader {
  root: ReqPlugin;
  henta: any;

  constructor(root) {
    this.root = root;
  }

  setHenta(henta) {
    this.henta = henta;
  }

  async init(henta) {
    const fileNames = await fs.readdir('src/requests/');
    return Promise.all(fileNames.map(v => this.loadFile(v)));
  }

  async loadFile(name) {
    const imported = await import(`file:///${this.henta.botdir}/src/requests/${name}`);
    const RequestHandlerClass = imported.default || imported;
    this.root.set(name.substring(0, name.length - 3), new RequestHandlerClass());
  }
}