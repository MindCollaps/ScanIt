import type { HomeAssistantConfig, HassButton } from '../../shared/types/config.js';
import type { ScanItMqttClient } from './client.js';
import { logger } from '../../server/logger.js';

interface HaDevicePayload {
  identifiers: string[];
  name: string;
  manufacturer: string;
  model: string;
}

/**
 * Publishes Home Assistant MQTT Discovery config messages so HA auto-creates entities.
 *
 * For each button we create:
 * - A **button** entity (command_topic → fires scan)
 * - A **sensor** entity (state_topic → shows job status)
 */
export class HassDiscovery {
  private readonly device: HaDevicePayload;
  private readonly discoveryPrefix: string;
  private publishedButtonIds = new Set<string>();

  public constructor(
    private readonly mqtt: ScanItMqttClient,
    private readonly config: HomeAssistantConfig,
  ) {
    this.discoveryPrefix = config.discovery.prefix;
    this.device = {
      identifiers: [config.discovery.deviceId],
      name: config.discovery.deviceName,
      manufacturer: 'ScanIt',
      model: 'Scanner Manager',
    };
  }

  /**
   * Publishes retained discovery configs for all configured buttons and
   * removes stale buttons that no longer exist in config.
   */
  public async publishAll(buttons: HassButton[]): Promise<void> {
    const currentIds = new Set(buttons.map((b) => b.id));

    // Remove stale buttons that were published before but are no longer in config
    for (const oldId of this.publishedButtonIds) {
      if (!currentIds.has(oldId)) {
        await this.removeButton(oldId);
      }
    }

    // Publish discovery for each button
    for (const button of buttons) {
      await this.publishButton(button);
    }

    this.publishedButtonIds = currentIds;
    logger.info({ count: buttons.length }, 'HA discovery published');
  }

  /**
   * Publishes discovery config for a single button (button entity + sensor entity).
   */
  private async publishButton(button: HassButton): Promise<void> {
    const prefix = this.mqtt.prefix;
    const deviceId = this.config.discovery.deviceId;
    const availability = {
      topic: `${prefix}/status`,
      payload_available: 'online',
      payload_not_available: 'offline',
    };

    // Button entity
    const buttonConfig = {
      name: button.label,
      unique_id: `${deviceId}_${button.id}`,
      command_topic: `${prefix}/button/${button.id}/command`,
      payload_press: 'PRESS',
      device: this.device,
      availability,
    };
    await this.mqtt.publish(
      `${this.discoveryPrefix}/button/${deviceId}/${button.id}/config`,
      JSON.stringify(buttonConfig),
      true,
    );

    // Status sensor entity
    const sensorConfig = {
      name: `${button.label} Status`,
      unique_id: `${deviceId}_${button.id}_status`,
      state_topic: `${prefix}/button/${button.id}/state`,
      device: this.device,
      availability,
    };
    await this.mqtt.publish(
      `${this.discoveryPrefix}/sensor/${deviceId}/${button.id}_status/config`,
      JSON.stringify(sensorConfig),
      true,
    );

    // Initial idle state
    await this.mqtt.publish(`${prefix}/button/${button.id}/state`, 'idle', true);
  }

  /**
   * Removes a button from HA by publishing empty retained messages to its discovery topics.
   */
  private async removeButton(buttonId: string): Promise<void> {
    const deviceId = this.config.discovery.deviceId;
    await this.mqtt.publish(
      `${this.discoveryPrefix}/button/${deviceId}/${buttonId}/config`,
      '',
      true,
    );
    await this.mqtt.publish(
      `${this.discoveryPrefix}/sensor/${deviceId}/${buttonId}_status/config`,
      '',
      true,
    );
    logger.debug({ buttonId }, 'HA discovery removed stale button');
  }
}
