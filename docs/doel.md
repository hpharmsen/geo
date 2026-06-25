# Doel

Een webapp die meet hoe vindbaar een merk is in AI-modellen (ChatGPT, Perplexity,
Gemini, Claude). De gebruiker vult een merk + categorie + concurrenten in, de
app stelt schone vragen via de AI-API's (meerdere runs per vraag, zonder
inloghistorie of geheugen), en toont **mention share**, **citatie share** en
**positie t.o.v. concurrenten** plus een markdown-rapport.

## Voor wie
Marketeers en merkverantwoordelijken die willen weten of "hun" merk bovenkomt
wanneer iemand een AI vraagt om een aanbeveling in hun categorie.

## Wat het oplost
SEO is meetbaar (Google rankings). AI-aanbevelingen zijn dat niet. Deze tool
levert een reproduceerbaar cijfer: "in X van Y antwoorden werd het merk
genoemd, op gemiddelde positie Z, vs concurrenten A en B".

## Niet-doelen
- Geen account- of historie-systeem; metingen zijn wegwerp per sessie.
- Geen prompt-engineering tool — de prompts zijn juist generiek en schoon om
  bias te vermijden.
- Geen real-time monitoring; één meting = één moment.
