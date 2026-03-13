import type { HomeAssistantConfig, HassButton } from '../../shared/types/config.js';
import type { IntegrationLogger } from '../../integration-core/adapter.js';
import type { ScanItMqttClient } from './client.js';

interface HaDevicePayload {
  identifiers: string[];
  name: string;
  manufacturer: string;
  model: string;
}

/**
 * Publishes Home Assistant MQTT Discovery config messages so HA auto-creates entities.
 *
 * We create:
 * - One **button** entity per configured scan trigger
 * - One global **sensor** for current ScanIt job status
 * - One global **sensor** for the latest warning/error message
 * - One **sensor** for current HA mode (default/double_sided/endless)
 * - One **button** to cycle mode
 * - One **button** to continue a held job
 */
export class HassDiscovery {
  private readonly device: HaDevicePayload;
  private readonly discoveryPrefix: string;
  private publishedButtonIds = new Set<string>();

  public constructor(
    private readonly mqtt: ScanItMqttClient,
    private readonly config: HomeAssistantConfig,
    private readonly logger: IntegrationLogger,
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

    await this.publishGlobalEntities();

    // Reconcile against retained discovery topics in the broker so we can
    // remove stale IDs even if this process never saw them before.
    const retainedButtonIds = await this.readRetainedButtonIdsFromBroker();
    for (const oldId of retainedButtonIds) {
      if (oldId !== 'mode_cycle' && oldId !== 'continue_job' && oldId !== 'discard_job' && oldId !== 'finalize_job' && !currentIds.has(oldId)) {
        await this.removeButton(oldId);
      }
    }

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
    this.logger.info('HA discovery published', { count: buttons.length });
  }

  private async readRetainedButtonIdsFromBroker(): Promise<string[]> {
    const deviceId = this.config.discovery.deviceId;
    const pattern = `${this.discoveryPrefix}/button/${deviceId}/+/config`;
    const topics = await this.mqtt.collectRetainedTopics(pattern);

    const ids: string[] = [];
    for (const topic of topics) {
      const parts = topic.split('/');
      const id = parts[parts.length - 2];
      if (id) ids.push(id);
    }
    return ids;
  }

  /**
   * Force-removes the provided button discovery entries.
   * Used during config reloads to ensure old retained button entities are cleared.
   */
  public async removeButtons(buttonIds: string[]): Promise<void> {
    const unique = new Set(buttonIds);
    for (const buttonId of unique) {
      await this.removeButton(buttonId);
      this.publishedButtonIds.delete(buttonId);
    }
  }

  /**
    * Publishes discovery config for a single trigger button.
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
      icon: 'mdi:scanner',
      device: this.device,
      availability,
    };
    await this.mqtt.publish(
      `${this.discoveryPrefix}/button/${deviceId}/${button.id}/config`,
      JSON.stringify(buttonConfig),
      true,
    );

    // Ensure legacy per-button status sensor is removed if it was retained by older versions.
    await this.mqtt.publish(`${this.discoveryPrefix}/sensor/${deviceId}/${button.id}_status/config`, '', true);
  }

  private async publishGlobalEntities(): Promise<void> {
    const prefix = this.mqtt.prefix;
    const deviceId = this.config.discovery.deviceId;
    const availability = {
      topic: `${prefix}/status`,
      payload_available: 'online',
      payload_not_available: 'offline',
    };

    const jobStatusSensor = {
      name: 'ScanIt Job Status',
      unique_id: `${deviceId}_job_status`,
      state_topic: `${prefix}/job/state`,
      json_attributes_topic: `${prefix}/job/attributes`,
      icon: 'mdi:file-clock-outline',
      device: this.device,
      availability,
    };
    await this.mqtt.publish(
      `${this.discoveryPrefix}/sensor/${deviceId}/job_status/config`,
      JSON.stringify(jobStatusSensor),
      true,
    );

    const jobIdSensor = {
      name: 'ScanIt Job Id',
      unique_id: `${deviceId}_job_id`,
      state_topic: `${prefix}/job/id`,
      icon: 'mdi:identifier',
      device: this.device,
      availability,
    };
    await this.mqtt.publish(
      `${this.discoveryPrefix}/sensor/${deviceId}/job_id/config`,
      JSON.stringify(jobIdSensor),
      true,
    );

    const jobMessageSensor = {
      name: 'ScanIt Message',
      unique_id: `${deviceId}_job_message`,
      state_topic: `${prefix}/job/message`,
      icon: 'mdi:message-alert-outline',
      device: this.device,
      availability,
    };
    await this.mqtt.publish(
      `${this.discoveryPrefix}/sensor/${deviceId}/job_message/config`,
      JSON.stringify(jobMessageSensor),
      true,
    );

    const modeSensor = {
      name: 'ScanIt Mode',
      unique_id: `${deviceId}_mode`,
      state_topic: `${prefix}/mode/state`,
      icon: 'mdi:tune-variant',
      device: this.device,
      availability,
    };
    await this.mqtt.publish(
      `${this.discoveryPrefix}/sensor/${deviceId}/mode/config`,
      JSON.stringify(modeSensor),
      true,
    );

    const modeButton = {
      name: 'Cycle Scan Mode',
      unique_id: `${deviceId}_mode_cycle`,
      command_topic: `${prefix}/mode/command`,
      payload_press: 'PRESS',
      icon: 'mdi:cached',
      device: this.device,
      availability,
    };
    await this.mqtt.publish(
      `${this.discoveryPrefix}/button/${deviceId}/mode_cycle/config`,
      JSON.stringify(modeButton),
      true,
    );

    const continueButton = {
      name: 'Continue Held Job',
      unique_id: `${deviceId}_continue_job`,
      command_topic: `${prefix}/continue/command`,
      payload_press: 'PRESS',
      icon: 'mdi:plus-box-multiple-outline',
      device: this.device,
      availability,
    };
    await this.mqtt.publish(
      `${this.discoveryPrefix}/button/${deviceId}/continue_job/config`,
      JSON.stringify(continueButton),
      true,
    );

    const discardButton = {
      name: 'Discard Held Scan',
      unique_id: `${deviceId}_discard_job`,
      command_topic: `${prefix}/discard/command`,
      payload_press: 'PRESS',
      icon: 'mdi:delete-sweep-outline',
      device: this.device,
      availability,
    };
    await this.mqtt.publish(
      `${this.discoveryPrefix}/button/${deviceId}/discard_job/config`,
      JSON.stringify(discardButton),
      true,
    );

    const finalizeButton = {
      name: 'Finalize Held Scan',
      unique_id: `${deviceId}_finalize_job`,
      command_topic: `${prefix}/finalize/command`,
      payload_press: 'PRESS',
      icon: 'mdi:check-circle-outline',
      device: this.device,
      availability,
    };
    await this.mqtt.publish(
      `${this.discoveryPrefix}/button/${deviceId}/finalize_job/config`,
      JSON.stringify(finalizeButton),
      true,
    );
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
    this.logger.debug('HA discovery removed stale button', { buttonId });
  }
}
