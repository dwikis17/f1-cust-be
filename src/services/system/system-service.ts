import { SystemRepository } from "../../repositories/system/system-repository.js";

export class SystemService {
  static async healthCheck() {
    await SystemRepository.healthCheck();
    return { status: "ok" };
  }
  static readPhoto(key: string) { return SystemRepository.readPhoto(key); }
}
