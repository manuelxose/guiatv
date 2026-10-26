// src/v2/infrastructure/parsers/XMLParser.ts

import { parseStringPromise } from 'xml2js';
import { logger } from '../../shared/utils/logger';

export interface ParsedXMLChannel {
  id: string;
  displayName: string;
  icon?: string;
  country?: string;
  countryCode?: string;
}

export interface ParsedXMLProgram {
  channelId: string;
  start: string; // "20251021080000 +0200"
  stop: string;
  title: string;
  subTitle?: string;
  description?: string;
  icon?: string | string[];
  category?: string;
  year?: string;
  rating?: string;
  sourceFeed?: string;
  sourceProgrammeId?: string;
  sourceAssetCandidates?: Array<Record<string, any>>;
  sourceProvenance?: Record<string, any>;
}

export interface ParsedXMLData {
  channels: ParsedXMLChannel[];
  programmes: ParsedXMLProgram[];
}

export class XMLParser {
  private readonly parserLogger = logger.child('XMLParser');

  /**
   * xml2js returns everything as arrays when `explicitArray` is true and
   * attribute values may also be wrapped. This helper consistently unwraps
   * the first scalar value and coerces it to string.
   */
  private firstValue(value: any): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (Array.isArray(value)) return this.firstValue(value[0]);
    if (typeof value === 'object' && '_' in value) return this.firstValue((value as any)._); // xml2js wraps text nodes in _
    const str = String(value).trim();
    return str === '' ? undefined : str;
  }

  async parse(xmlContent: string): Promise<ParsedXMLData> {
    try {
      this.parserLogger.info('Starting XML parse');

      const json = await parseStringPromise(xmlContent, {
        mergeAttrs: true,
        explicitArray: true,
      });

      if (!json || !json.tv) {
        throw new Error('Invalid XML structure: missing tv root element');
      }

      const channels = this.parseChannels(json.tv.channel || []);
      const programmes = this.parseProgrammes(json.tv.programme || []);

      this.parserLogger.info('XML parsed successfully', {
        channelsCount: channels.length,
        programmesCount: programmes.length,
      });

      return { channels, programmes };
    } catch (error) {
      this.parserLogger.error('Failed to parse XML', error as Error);
      throw error;
    }
  }

  private parseChannels(channelsData: any[]): ParsedXMLChannel[] {
    return channelsData.map((ch) => {
      const id = this.firstValue(ch.id ?? ch.$?.id) || '';
      let displayName = this.firstValue(ch['display-name']) || '';
      displayName = displayName.replace(/^(ES|PT|UK|FR|DE|US|IT|RU|AR|MX)\s*-\s*/i, '').trim();
      const icon = this.firstValue(ch.icon?.[0]?.src ?? ch.icon?.[0]?.$?.src);
      const { country, countryCode } = this.extractCountry(id, displayName);

      return {
        id,
        displayName,
        icon,
        country,
        countryCode,
      };
    });
  }

  private parseProgrammes(programmesData: any[]): ParsedXMLProgram[] {
    return programmesData.map((prog) => ({
      channelId: this.firstValue(prog.channel ?? prog.$?.channel) || '',
      start: this.firstValue(prog.start ?? prog.$?.start) || '',
      stop: this.firstValue(prog.stop ?? prog.$?.stop) || '',
      title: this.firstValue(prog.title) || '',
      subTitle: this.firstValue(prog['sub-title']),
      description: this.extractDescription(prog),
      icon: this.firstValue(prog.icon?.[0]?.src ?? prog.icon?.[0]?.$?.src),
      category: this.firstValue(prog.category),
      year: this.extractYear(prog),
      rating: this.extractRating(prog),
    }));
  }

  private extractDescription(prog: any): string | undefined {
    const desc = this.firstValue(prog.desc);
    if (!desc) return undefined;
    const trimmed = desc.trim();
    return trimmed ? trimmed.substring(0, 500) : undefined;
  }

  private extractYear(prog: any): string | undefined {
    const desc = this.firstValue(prog.desc) || '';
    const yearMatch = desc.match(/\b(19|20)\d{2}\b/);
    return yearMatch ? yearMatch[0] : undefined;
  }

  private extractRating(prog: any): string | undefined {
    // Prefer explicit rating node if present, otherwise best effort from description
    const ratingValue =
      this.firstValue(prog.rating?.[0]?.value) ??
      this.firstValue(prog['star-rating']?.[0]?.value);

    if (ratingValue) {
      return String(ratingValue);
    }

    const desc = this.firstValue(prog.desc) || '';
    const ratingMatch = desc.match(/\d\/\d/);
    return ratingMatch ? ratingMatch[0] : undefined;
  }

  private extractCountry(id: string, displayName: string): {
    country?: string;
    countryCode?: string;
  } {
    const candidates: string[] = [];

    const left = (id || '').split('|')[0]?.trim();
    if (left) candidates.push(left);

    const leftName = (displayName || '').split('|')[0]?.trim();
    if (leftName) candidates.push(leftName);

    const parenMatch = displayName?.match(/\(([^)]+)\)/);
    if (parenMatch?.[1]) {
      candidates.push(parenMatch[1].trim());
    }

    const normalized = (val: string) => val.toLowerCase();

    const map: Record<string, { code: string; name: string }> = {
      españa: { code: 'ES', name: 'España' },
      spain: { code: 'ES', name: 'España' },
      uk: { code: 'GB', name: 'Reino Unido' },
      'reino unido': { code: 'GB', name: 'Reino Unido' },
      usa: { code: 'US', name: 'Estados Unidos' },
      'estados unidos': { code: 'US', name: 'Estados Unidos' },
      mexico: { code: 'MX', name: 'México' },
      chile: { code: 'CL', name: 'Chile' },
      argentina: { code: 'AR', name: 'Argentina' },
      colombia: { code: 'CO', name: 'Colombia' },
      bolivia: { code: 'BO', name: 'Bolivia' },
      peru: { code: 'PE', name: 'Perú' },
      portugal: { code: 'PT', name: 'Portugal' },
      brasil: { code: 'BR', name: 'Brasil' },
    };

    for (const candidate of candidates) {
      const key = normalized(candidate);
      if (map[key]) {
        return { country: map[key].name, countryCode: map[key].code };
      }
    }

    return {};
  }
}
