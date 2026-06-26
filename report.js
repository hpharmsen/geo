// Bouwt rapport.md — markdown-rapport dat de gebruiker als PROMPT kan plakken
// om er een gebrand PDF van te laten maken. Port van geo/report.py.

const RE_ESCAPE = /[.*+?^${}()|[\]\\]/g;

function _escape(s) {
  return s.replace(RE_ESCAPE, '\\$&');
}

function _boldMerk(text, merk) {
  if (!merk) return text;
  const re = new RegExp('(' + _escape(merk) + ')', 'gi');
  return text.replace(re, '**$1**');
}

function _pct(x) {
  if (x === null || x === undefined) return 'n.v.t.';
  return Math.round(x * 100) + '%';
}

const PROVIDER_LABELS = {
  openai: 'ChatGPT (OpenAI)',
  perplexity: 'Perplexity',
  gemini: 'Gemini (Google)',
  anthropic: 'Claude (Anthropic)',
};

function _providerLabel(p) {
  return PROVIDER_LABELS[p] || p;
}

const MODUS_UITLEG = {
  kaal: "**Uit het geheugen** — de AI antwoordt zonder live te zoeken, puur uit z'n trainingsdata. Dit laat zien of je merk een herkende entiteit is.",
  zoeken: '**Met live zoeken** — de AI zoekt tijdens het antwoord op het web. Dit lijkt het meest op wat een echte gebruiker ziet.',
};

function _modusBlok(L, result, modus) {
  const merk = result.merknaam;
  const rows = (result.rows || []).filter(r => r.modus === modus);
  const totaal = (result.totaal_per_modus || {})[modus] || {};
  const concurrenten = (result.concurrenten_per_modus || {})[modus] || {};
  const toonPositie = !!result.heeft_concurrenten;

  L.push('- **Mention share (totaal):** ' + _pct(totaal.mention_share) +
         ' — aandeel van de metingen waarin de AI het merk spontaan noemde.');
  L.push('- **Citatie share (totaal):** ' + _pct(totaal.citatie_share) +
         ' — aandeel waarin de eigen website als bron werd genoemd.');
  if (toonPositie && totaal.gem_positie !== null && totaal.gem_positie !== undefined) {
    L.push('- **Gemiddelde positie:** ' + totaal.gem_positie +
           ' — gemiddelde plek in de volgorde t.o.v. je opgegeven concurrenten (1 = als eerste genoemd).');
  }
  L.push('');

  if (toonPositie) {
    L.push('| AI-model | Runs | Mention share | Citatie share | Gemiddelde positie |');
    L.push('|---|---|---|---|---|');
    for (const agg of rows) {
      L.push('| ' + _providerLabel(agg.provider) +
             ' | ' + agg.runs +
             ' | ' + _pct(agg.mention_share) +
             ' | ' + _pct(agg.citatie_share) +
             ' | ' + (agg.gem_positie !== null && agg.gem_positie !== undefined ? agg.gem_positie : '—') +
             ' |');
    }
  } else {
    L.push('| AI-model | Runs | Mention share | Citatie share |');
    L.push('|---|---|---|---|');
    for (const agg of rows) {
      L.push('| ' + _providerLabel(agg.provider) +
             ' | ' + agg.runs +
             ' | ' + _pct(agg.mention_share) +
             ' | ' + _pct(agg.citatie_share) +
             ' |');
    }
  }
  L.push('');

  const concurrentNames = Object.keys(concurrenten);
  if (concurrentNames.length > 0) {
    L.push('**Positie t.o.v. concurrenten** (mention share per merk)');
    L.push('');
    const rij = [[merk, totaal.mention_share || 0]];
    for (const c of concurrentNames) rij.push([c, concurrenten[c]]);
    L.push('| Merk | Mention share |');
    L.push('|---|---|');
    const sorted = [...rij].sort((a, b) => (b[1] || 0) - (a[1] || 0));
    for (const [naam, share] of sorted) {
      const ster = naam === merk ? ' *(jij)*' : '';
      L.push('| ' + naam + ster + ' | ' + _pct(share) + ' |');
    }
    L.push('');
  }
}

function _bewijsBlok(L, result, modus) {
  const items = (result.antwoorden || []).filter(a => a.modus === modus);
  if (!items.length) return;
  const merk = result.merknaam;
  const promptset = result.promptset || [];
  const order = {};
  promptset.forEach((p, i) => { order[p] = i; });
  const prompts = [...new Set(items.map(a => a.prompt))].sort(
    (a, b) => (order[a] ?? 999) - (order[b] ?? 999));

  L.push('<details><summary><b>Bekijk de antwoorden (bewijs)</b></summary>');
  L.push('');
  for (const prompt of prompts) {
    L.push('**Vraag:** ' + prompt);
    L.push('');
    for (const a of items.filter(x => x.prompt === prompt)) {
      const freq = a.runs
        ? `genoemd in ${a.mentioned_count}/${a.runs} runs`
        : 'geen geslaagde runs';
      L.push('- *' + _providerLabel(a.provider) + '* — ' + freq);
      if (a.voorbeeld_error) {
        L.push('  > *(call mislukt)*');
      } else {
        const tekst = _boldMerk((a.voorbeeld_text || '').trim(), merk);
        const regels = tekst.split('\n');
        if (regels.length === 0) regels.push('');
        for (const regel of regels) L.push('  > ' + regel);
      }
      L.push('');
    }
  }
  L.push('</details>');
  L.push('');
}

export function buildReport(result) {
  const merk = result.merknaam;
  const datum = result.datum;
  const modi = result.modi || [];
  const modusLabels = result.modus_labels || {};
  const demo = !!result.demo_modus;
  const analyseTitel = result.analyse_titel || 'Diepte-analyses';

  const L = [];
  L.push(
    '> **Instructie:** Gebruik onderstaande meetresultaten om een professioneel, ' +
    'white-label GEO-rapport (PDF) te maken in de huisstijl van het bureau. ' +
    'Vul logo, kleuren en bureaunaam zelf in op de gemarkeerde plekken.');
  L.push('');
  L.push('# GEO-zichtbaarheidsrapport — ' + merk);
  L.push('');
  L.push('*Meting uitgevoerd op ' + datum + '.*  ');
  L.push('*Branding: [LOGO BUREAU] · [KLEUREN] · [BUREAUNAAM]*');
  L.push('');

  if (demo) {
    L.push('> ⚠️ **Let op:** deze meting draaide (deels) in **demo-modus** zonder echte API-keys. ' +
           'De cijfers zijn illustratief, niet representatief.');
    L.push('');
  }

  L.push('## Wat is gemeten');
  L.push('');
  for (const m of modi) {
    L.push('- ' + (MODUS_UITLEG[m] || modusLabels[m] || m));
  }
  if (!result.heeft_concurrenten) {
    L.push('- *Er zijn geen concurrenten opgegeven, daarom tonen we geen positie-cijfer ' +
           '(positie is alleen zinvol t.o.v. concurrenten).*');
  }
  L.push('');

  for (const m of modi) {
    L.push(modi.length > 1 ? '## ' + (modusLabels[m] || m) : '## Resultaat');
    L.push('');
    _modusBlok(L, result, m);
    _bewijsBlok(L, result, m);
  }

  const boek = result.boek_analyses || [];
  if (boek.length > 0) {
    L.push('## ' + analyseTitel);
    L.push('');
    const boekBron = String(result.boek_model || 'de AI').split(' (')[0];
    L.push('De volgende uitgebreide GEO-analyses zijn uitgevoerd door ' + boekBron + ' voor ' + merk + '.');
    L.push('');
    for (const a of boek) {
      L.push('### ' + a.titel);
      L.push('');
      if (a.uitleg) {
        L.push('*' + a.uitleg + '*');
        L.push('');
      }
      if (a.prompt) {
        L.push('<details><summary>Toon de exacte vraag aan de AI</summary>');
        L.push('');
        for (const regel of a.prompt.trim().split('\n')) {
          L.push('> ' + regel);
        }
        L.push('');
        L.push('</details>');
        L.push('');
      }
      if (a.error) {
        L.push('*Niet gelukt: ' + String(a.error) + '*');
      } else {
        L.push((a.antwoord || '').trim());
      }
      L.push('');
    }
  }

  L.push('## Methodische noot');
  L.push('');
  L.push('Deze meting gebruikt de **API** van de AI-modellen — het \'kale\' model, ' +
         'schoon en reproduceerbaar, zonder geheugen of inloghistorie. Dat is niet ' +
         'identiek aan wat een ingelogde gebruiker in de web-app ziet. De waarde zit ' +
         'niet in één absolute meting, maar in **dezelfde meetopstelling herhaald over ' +
         'de tijd**: zo zie je of je GEO-werk effect heeft. Elke prompt is ' +
         (result.runs_per_prompt ?? '?') + '× schoon opnieuw gesteld.');
  L.push('');

  return L.join('\n');
}

export function aanbevelingen(totaal, concurrenten, merk) {
  const out = [];
  const ms = totaal.mention_share ?? 0.0;
  const cs = totaal.citatie_share ?? 0.0;

  if (ms < 0.3) {
    out.push("**Vergroot je entiteit-signaal.** Het merk wordt zelden spontaan genoemd. " +
             "Werk aan vermeldingen in vakmedia, een Wikidata-item en consistente NAW/sameAs-gegevens, " +
             "zodat AI-modellen het merk als relevante speler in de categorie herkennen.");
  } else if (ms < 0.6) {
    out.push("**Verstevig je positie in de categorie.** Het merk komt al voor, maar niet consistent. " +
             "Publiceer categorie- en vergelijkingscontent ('beste X', 'X vs Y') zodat het merk vaker " +
             "in de shortlist belandt.");
  } else {
    out.push("**Behoud en verdedig je sterke positie.** Het merk wordt vaak genoemd. " +
             "Houd content actueel en monitor of concurrenten terrein winnen.");
  }

  if (cs < 0.3) {
    out.push("**Maak je content citeerbaar.** De eigen website wordt zelden als bron genoemd. " +
             "Voeg heldere, overneembare antwoorden toe (TL;DR, FAQ-blokken, bronvermelding) en " +
             "zorg dat AI-bots toegang hebben (robots.txt, llms.txt).");
  } else {
    out.push("**Bouw je citatie-voorsprong uit.** Je wordt al als bron geciteerd; breid citeerbare " +
             "content uit naar meer categorie-vragen.");
  }

  const namen = Object.keys(concurrenten || {});
  if (namen.length > 0) {
    let sterksteNaam = namen[0];
    for (const n of namen) {
      if ((concurrenten[n] || 0) > (concurrenten[sterksteNaam] || 0)) sterksteNaam = n;
    }
    const sterksteShare = concurrenten[sterksteNaam];
    if (sterksteShare > ms) {
      out.push("**Analyseer " + sterksteNaam + ".** Die scoort hoger op spontane vermelding (" +
               _pct(sterksteShare) + " vs " + _pct(ms) + "). Kijk welke content en bronnen die " +
               "concurrent sterk maken bij AI-modellen en sluit het gat.");
    } else {
      out.push("**Houd je voorsprong vast.** Je scoort op spontane vermelding hoger dan je " +
               "opgegeven concurrenten — blijf publiceren om dat zo te houden.");
    }
  } else {
    out.push("**Voeg concurrenten toe aan de meting** om je relatieve positie te kunnen volgen.");
  }

  return out;
}

export const _internal = { _pct, _providerLabel, _boldMerk };
