// Icons: TheePepS/League_Of_Legends_Assets, commit 6d4dd81a9fde8408d409f9b76b914b7485bd037e
// Filenames are normalized from upstream display names; see README for attribution.
const champions = Object.freeze([
  "aatrox", "ahri", "akali", "akshan", "alistar", "ambessa", "amumu", "anivia", "annie", "aphelios",
  "ashe", "aurelionsol", "aurora", "azir", "bard", "belveth", "blitzcrank", "brand", "braum", "briar",
  "caitlyn", "camille", "cassiopeia", "chogath", "corki", "darius", "diana", "drmundo", "draven", "ekko",
  "elise", "evelynn", "ezreal", "fiddlesticks", "fiora", "fizz", "galio", "gangplank", "garen", "gnar",
  "gragas", "graves", "gwen", "hecarim", "heimerdinger", "hwei", "illaoi", "irelia", "ivern", "janna",
  "jarvaniv", "jax", "jayce", "jhin", "jinx", "ksante", "kaisa", "kalista", "karma", "karthus",
  "kassadin", "katarina", "kayle", "kayn", "kennen", "khazix", "kindred", "kled", "kogmaw", "leblanc",
  "leesin", "leona", "lillia", "lissandra", "locke", "lucian", "lulu", "lux", "malphite", "malzahar",
  "maokai", "masteryi", "mel", "milio", "missfortune", "mordekaiser", "morgana", "naafiri", "nami", "nasus",
  "nautilus", "neeko", "nidalee", "nilah", "nocturne", "nunuwillump", "olaf", "orianna", "ornn", "pantheon",
  "poppy", "pyke", "qiyana", "quinn", "rakan", "rammus", "reksai", "rell", "renataglasc", "renekton",
  "rengar", "riven", "rumble", "ryze", "samira", "sejuani", "senna", "seraphine", "sett", "shaco",
  "shen", "shyvana", "singed", "sion", "sivir", "skarner", "smolder", "sona", "soraka", "swain",
  "sylas", "syndra", "tahmkench", "taliyah", "talon", "taric", "teemo", "thresh", "tristana", "trundle",
  "tryndamere", "twistedfate", "twitch", "udyr", "urgot", "varus", "vayne", "veigar", "velkoz", "vex",
  "vi", "viego", "viktor", "vladimir", "volibear", "warwick", "wukong", "xayah", "xerath", "xinzhao",
  "yasuo", "yone", "yorick", "yunara", "yuumi", "zaahen", "zac", "zed", "zeri", "ziggs",
  "zilean", "zoe", "zyra",
]);

const aliases = Object.freeze({monkeyking: 'wukong', nunu: 'nunuwillump', renata: 'renataglasc'});
const escape = value => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export function championIconPath(name) {
  if (typeof name !== 'string') return null;
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const slug = Object.hasOwn(aliases, normalized) ? aliases[normalized] : normalized;
  return champions.includes(slug) ? '/champions/' + slug + '.png' : null;
}

export function championAvatar(name, small = false) {
  const label = typeof name === 'string' ? name : '';
  const path = championIconPath(label);
  const tone = [...label].reduce((total, char) => total + char.charCodeAt(0), 0) % 4;
  const initials = escape(label.slice(0, 2).toUpperCase() || '?');
  const image = path ? '<img data-champion-icon src="' + path + '" alt="" width="128" height="128" loading="lazy" decoding="async">' : '';
  return '<span class="champion-avatar ' + (small ? 'small-avatar ' : '') + 'tone-' + tone + '" aria-hidden="true"><span class="champion-initials">' + initials + '</span>' + image + '</span>';
}
