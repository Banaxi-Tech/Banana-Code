import chalk from 'chalk';
import ora from 'ora';

export async function duckDuckGoScrape({ query }) {
    const url = `https://duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const userAgent = 'BananaCode/1.0 (AI-Agent)';
    
    const spinner = ora({ text: `Scraping DuckDuckGo Lite for ${chalk.cyan(query)}...`, color: 'yellow', stream: process.stdout }).start();

    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': userAgent
            }
        });

        if (res.status === 403 || res.status === 429) {
            if (spinner.isSpinning) spinner.stop();
            return "ERROR: We are currently Rate Limited by DuckDuckGo. Please try again later or use the Quick Answer tool.";
        }

        if (!res.ok) {
            if (spinner.isSpinning) spinner.stop();
            return `Error: DuckDuckGo returned HTTP ${res.status}`;
        }

        const html = await res.text();
        if (spinner.isSpinning) spinner.stop();

        // Basic "scraping" using regex since we don't have a full DOM parser like JSDOM here
        // DuckDuckGo Lite results are usually in <a class="result-link" href="...">...</a>
        // and have a titles in them.
        
        const results = [];
        // More flexible regex to find result-link tags
        const tagRegex = /<a\s+[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi;
        
        let match;
        while ((match = tagRegex.exec(html)) !== null) {
            const fullTag = match[0];
            const title = match[1].replace(/<[^>]*>/g, '').trim();
            const hrefMatch = /href=['"]([^'"]+)['"]/i.exec(fullTag);
            
            if (hrefMatch) {
                let link = hrefMatch[1];

                // Extract the actual URL from the uddg parameter if present
                if (link.includes('uddg=')) {
                    // Extract using manual split if URLSearchParams is finicky with partials
                    const uddgPart = link.split('uddg=')[1]?.split('&')[0];
                    if (uddgPart) {
                        try {
                            link = decodeURIComponent(uddgPart);
                        } catch (e) { }
                    }
                }
                
                // Ensure link is absolute
                if (link.startsWith('//')) {
                    link = 'https:' + link;
                } else if (link.startsWith('/')) {
                    link = 'https://duckduckgo.com' + link;
                }

                results.push({ title, link });
            }
        }

        if (results.length === 0) {
            // Try alternative regex if the first one fails (lite structure can change)
            const altRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
            let altMatch;
            let count = 0;
            while ((altMatch = altRegex.exec(html)) !== null && count < 10) {
                const link = altMatch[1];
                if (link.startsWith('http') && !link.includes('duckduckgo.com')) {
                    const title = altMatch[2].replace(/<[^>]*>/g, '').trim();
                    results.push({ title, link });
                    count++;
                }
            }
        }

        if (results.length === 0) {
            return "No results found on DuckDuckGo Lite.";
        }

        return JSON.stringify(results.slice(0, 10), null, 2);
    } catch (err) {
        if (spinner.isSpinning) spinner.stop();
        return `Error scraping DuckDuckGo: ${err.message}`;
    }
}
