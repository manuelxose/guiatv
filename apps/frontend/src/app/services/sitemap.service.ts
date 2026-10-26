import { Injectable } from '@angular/core';

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
}

@Injectable({
  providedIn: 'root'
})
export class SitemapService {
  private readonly baseUrl = 'https://guiaprogramaciontv.com';
  
  /**
   * Generate sitemap XML content dynamically
   */
  generateSitemapXML(): string {
    const urls = this.getAllUrls();
    
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    
    for (const url of urls) {
      xml += '  <url>\n';
      xml += `    <loc>${this.baseUrl}${url.loc}</loc>\n`;
      if (url.lastmod) {
        xml += `    <lastmod>${url.lastmod}</lastmod>\n`;
      }
      if (url.changefreq) {
        xml += `    <changefreq>${url.changefreq}</changefreq>\n`;
      }
      if (url.priority !== undefined) {
        xml += `    <priority>${url.priority.toFixed(1)}</priority>\n`;
      }
      xml += '  </url>\n';
    }
    
    xml += '</urlset>';
    return xml;
  }

  /**
   * Get all static URLs for the sitemap
   */
  getAllUrls(): SitemapUrl[] {
    const today = new Date().toISOString().split('T')[0];
    
    return [
      // Main pages - highest priority
      { loc: '/', lastmod: today, changefreq: 'daily', priority: 1.0 },
      
      // Content pages - high priority
      { loc: '/programacion-tv/que-ver-hoy', lastmod: today, changefreq: 'daily', priority: 0.9 },
      { loc: '/programacion-tv/en-directo', lastmod: today, changefreq: 'hourly', priority: 0.9 },
      { loc: '/programacion-tv/peliculas', lastmod: today, changefreq: 'daily', priority: 0.9 },
      { loc: '/programacion-tv/series', lastmod: today, changefreq: 'daily', priority: 0.9 },
      { loc: '/canales', lastmod: today, changefreq: 'hourly', priority: 0.8 },
      // The final URL, not `/deportes` (a 301 to it).
      { loc: '/deportes/futbol', lastmod: today, changefreq: 'hourly', priority: 0.9 },
      
      // Editorial - medium-high priority
      { loc: '/guias', lastmod: today, changefreq: 'daily', priority: 0.8 },
      { loc: '/guias/rankings', lastmod: today, changefreq: 'weekly', priority: 0.7 },
      
      // Legal pages - low priority
      { loc: '/avisolegal', lastmod: today, changefreq: 'monthly', priority: 0.3 },
      { loc: '/privacidad', lastmod: today, changefreq: 'monthly', priority: 0.3 },
      { loc: '/cookies', lastmod: today, changefreq: 'monthly', priority: 0.3 },
      { loc: '/terminos', lastmod: today, changefreq: 'monthly', priority: 0.3 },
      { loc: '/accesibilidad', lastmod: today, changefreq: 'monthly', priority: 0.3 },
      { loc: '/embed', lastmod: today, changefreq: 'monthly', priority: 0.4 },
      { loc: '/tendencias', lastmod: today, changefreq: 'daily', priority: 0.8 },
      { loc: '/sitemap', lastmod: today, changefreq: 'weekly', priority: 0.4 },
    ];
  }

  /**
   * Generate RSS XML content
   */
  generateRssXML(items: { title: string; link: string; description: string; pubDate: Date }[]): string {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n';
    xml += '  <channel>\n';
    xml += '    <title>GPTV - Tu Guía de TV Social</title>\n';
    xml += `    <link>${this.baseUrl}</link>\n`;
    xml += '    <description>Descubre, comparte y conecta con lo que el mundo está viendo.</description>\n';
    xml += '    <language>es-ES</language>\n';
    xml += `    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n`;
    xml += `    <atom:link href="${this.baseUrl}/rss.xml" rel="self" type="application/rss+xml"/>\n`;
    
    for (const item of items) {
      xml += '    <item>\n';
      xml += `      <title><![CDATA[${item.title}]]></title>\n`;
      xml += `      <link>${this.baseUrl}${item.link}</link>\n`;
      xml += `      <description><![CDATA[${item.description}]]></description>\n`;
      xml += `      <pubDate>${item.pubDate.toUTCString()}</pubDate>\n`;
      xml += `      <guid>${this.baseUrl}${item.link}</guid>\n`;
      xml += '    </item>\n';
    }
    
    xml += '  </channel>\n';
    xml += '</rss>';
    return xml;
  }

  /**
   * Download sitemap as file
   */
  downloadSitemap(): void {
    const xml = this.generateSitemapXML();
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sitemap.xml';
    a.click();
    window.URL.revokeObjectURL(url);
  }

  /**
   * Download RSS as file
   */
  downloadRss(items: { title: string; link: string; description: string; pubDate: Date }[]): void {
    const xml = this.generateRssXML(items);
    const blob = new Blob([xml], { type: 'application/rss+xml' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rss.xml';
    a.click();
    window.URL.revokeObjectURL(url);
  }
}
