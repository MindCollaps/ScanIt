import { connectAsync, type MqttClient } from 'mqtt';
import type { HomeAssistantConfig } from '../../shared/types/config.js';
import { logger } from '../../server/logger.js';

export interface MqttClientOptions {
  brokerUrl: string;
  username: string;
  password: string;
  clientId: string;
  topicPrefix: string;
}

/**
 * Thin wrapper around the mqtt.js client, handling connection lifecycle and LWT.
 */
export class ScanItMqttClient {
  private client: MqttClient | undefined;
  private readonly options: MqttClientOptions;

  public constructor(config: HomeAssistantConfig) {
    this.options = {
      brokerUrl: config.mqtt.brokerUrl,
      username: config.mqtt.username,
      password: config.mqtt.password,
      clientId: config.mqtt.clientId ?? 'scanit',
      topicPrefix: config.mqtt.topicPrefix ?? 'scanit',
    };
  }

  public get prefix(): string {
    return this.options.topicPrefix;
  }

  public get connected(): boolean {
    return this.client?.connected === true;
  }

  public async connect(): Promise<void> {
    const statusTopic = `${this.options.topicPrefix}/status`;

    try {
      this.client = await connectAsync(this.options.brokerUrl, {
        clientId: this.options.clientId,
        username: this.options.username,
        password: this.options.password,
        clean: true,
        will: {
          topic: statusTopic,
          payload: Buffer.from('offline'),
          retain: true,
          qos: 1,
        },
        reconnectPeriod: 5000,
      });
    } catch (error: unknown) {
      const detail =
        error instanceof Error
          ? error.message
          : error && typeof error === 'object' && 'code' in error
            ? String((error as Record<string, unknown>).code)
            : String(error) || 'unknown connection error';
      throw new Error(
        `Failed to connect to MQTT broker '${this.options.brokerUrl}': ${detail}`,
      );
    }

    // Publish online status
    await this.client.publishAsync(statusTopic, 'online', { retain: true, qos: 1 });
    logger.info({ broker: this.options.brokerUrl, clientId: this.options.clientId }, 'MQTT connected');
  }

  public async publish(topic: string, payload: string, retain = false): Promise<void> {
    if (!this.client?.connected) {
      logger.warn({ topic }, 'MQTT publish skipped – not connected');
      return;
    }
    await this.client.publishAsync(topic, payload, { retain, qos: 1 });
  }

  public async subscribe(
    topic: string,
    handler: (topic: string, payload: Buffer) => void,
  ): Promise<void> {
    if (!this.client) {
      throw new Error('MQTT client not connected');
    }
    this.client.on('message', (receivedTopic, payload) => {
      if (mqttTopicMatch(topic, receivedTopic)) {
        handler(receivedTopic, payload);
      }
    });
    await this.client.subscribeAsync(topic, { qos: 1 });
    logger.debug({ topic }, 'MQTT subscribed');
  }

  public async disconnect(): Promise<void> {
    if (!this.client) return;
    const statusTopic = `${this.options.topicPrefix}/status`;
    try {
      await this.client.publishAsync(statusTopic, 'offline', { retain: true, qos: 1 });
    } catch {
      // Best-effort offline message
    }
    await this.client.endAsync();
    this.client = undefined;
    logger.info('MQTT disconnected');
  }
}

/**
 * Matches an MQTT topic against a subscription pattern with single-level (+) wildcards.
 */
function mqttTopicMatch(pattern: string, topic: string): boolean {
  const patternParts = pattern.split('/');
  const topicParts = topic.split('/');
  if (patternParts.length !== topicParts.length) return false;
  return patternParts.every((p, i) => p === '+' || p === topicParts[i]);
}
