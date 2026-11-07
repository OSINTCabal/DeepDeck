/** One startup task, including preparation, explicit retry, and safe boot rollback. */
class HarnessStartup {
  constructor({ harness, runtime, getAutoUpdate, validate, onProgress = () => {}, onBusy = () => {}, onRuntimeChange = async () => {} }) {
    Object.assign(this, { harness, runtime, getAutoUpdate, validate, onProgress, onBusy, onRuntimeChange });
    this.pending = null;
  }
  start(options = {}) {
    if (this.pending) return this.pending;
    this.onBusy(true);
    this.harness.setState('preparing');
    this.pending = this.prepare(options).finally(() => {
      this.pending = null;
      this.onProgress(null);
      this.onBusy(false);
    });
    return this.pending;
  }
  async prepare({ retry = false } = {}) {
    const previousId = this.runtime.current()?.id || null;
    try {
      const options = { validate: this.validate, onProgress: this.onProgress };
      if (retry && !previousId) await this.runtime.update(options);
      else await this.runtime.prepare({ ...options, autoUpdate: this.getAutoUpdate() });
      if (this.runtime.current()?.id !== previousId) await this.onRuntimeChange();
      return await this.harness.start();
    } catch (error) {
      if (this.runtime.current()?.id && this.runtime.current().id !== previousId) {
        await this.harness.stop();
        this.runtime.rollbackBoot(previousId, error.message);
        if (previousId) {
          await this.runtime.prepare({ autoUpdate: false });
          return await this.harness.start();
        }
      }
      this.harness.setState('error', error.message);
      throw error;
    }
  }
}
module.exports = { HarnessStartup };
