import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import YAML from "yaml";
import nunjucks from "nunjucks";
import fs from "fs/promises";
import path from "path";
import del from "del";
import makeDir from "make-dir";
import cpy from "cpy";
import download from "download";
import extract from "extract-zip";

interface Work {
	order: number;
	code: string;
	title: string;
	suffix: string;
	cover: string;
	hidden: boolean;
	tags: Tags;
	items: Item[];
}

interface Item {
	title: string;
	type: string[];
	links: Links;
}

interface Links {
	wiki: string;
	ja?: true | string;
	zh?: true | string;
}

interface Tags {
	era: string;
	state: string;
	type?: string[];
}

interface Download {
	source: string;
	target: string;
}

interface Translate {
	src: string;
	ja: string;
	zh: string;
}

async function readYAMLFile<T>(path: string): Promise<T> {
	return YAML.parse(await fs.readFile(path, { encoding: "utf-8" }));
}

function chunks<T>(arr: T[], size: number) {
	const output: T[][] = [];
	for (let i = 0; i < arr.length; i += size) {
		output.push(arr.slice(i, i + size));
	}
	return output;
}

const SITE_ROOT = "public";
const SOURCE_ROOT = "src";
const STATIC_ROOT = SOURCE_ROOT + "/static";
const DATA_ROOT = SOURCE_ROOT + "/data";
const WORKS_ROOT = SOURCE_ROOT + "/works";
const MANUALZIP_ROOT = SOURCE_ROOT + "/manual";
const COVER_ROOT = "/cover";
const MANUAL_ROOT = "/manual";
const TRANSLATE_ROOT = "/translate";

await del(SITE_ROOT);
await makeDir(SITE_ROOT);
await makeDir(SITE_ROOT + COVER_ROOT);
await makeDir(SITE_ROOT + MANUAL_ROOT);
await makeDir(SITE_ROOT + TRANSLATE_ROOT);

await cpy(STATIC_ROOT + "/**", SITE_ROOT);

const works: Work[] = [];
for (const name of await fs.readdir(WORKS_ROOT, { encoding: "utf-8" })) {
	if (name.endsWith(".yaml")) {
		const work: Work = await readYAMLFile(path.join(WORKS_ROOT, name));

		work.tags.type = work.items.flatMap((item) => item.type).filter((v, i, a) => a.indexOf(v) === i);
		works.push(work);
	}
}
works.sort((a, b) => a.order - b.order);

const types: string[] = await readYAMLFile(path.join(DATA_ROOT, "type.yaml"));
const downloads: Download[] = await readYAMLFile(path.join(DATA_ROOT, "download.yaml"));
const translates: Translate[] = [];

for (const work of works) {
	let cover = downloads.find((c) => c.source === work.cover);
	if (cover == null) {
		const extension = path.extname(work.cover);
		cover = {
			source: work.cover,
			target: `${COVER_ROOT}/${work.code}.${extension}`,
		};
		downloads.push(cover);
	}
	work.cover = cover.target;

	for (const item of work.items) {
		const safeName = item.links.wiki
			.replace(/^.+:/, "")
			.replace(/[:\/\s&]+/g, "_")
			.toLowerCase();
		if (item.links.ja == null || item.links.zh == null) {
			const translate: Translate = {
				src: `https://cache.thwiki.cc/${item.links.wiki}`,
				ja: `${TRANSLATE_ROOT}/${safeName}.ja.txt`,
				zh: `${TRANSLATE_ROOT}/${safeName}.zh.txt`,
			};

			translates.push(translate);
			if (item.links.ja == null) item.links.ja = translate.ja;
			if (item.links.zh == null) item.links.zh = translate.zh;
		}
	}
}

nunjucks.configure(SOURCE_ROOT + "/");

console.log("build index page");
const indexHtml = nunjucks.render("index.html.njk", {
	works,
	types,
});
await fs.writeFile(path.join(SITE_ROOT, "index.html"), indexHtml, { encoding: "utf8" });

console.log("build not found page");
const notFoundHtml = nunjucks.render("404.html.njk", {
	works,
	types,
});
await fs.writeFile(path.join(SITE_ROOT, "404.html"), notFoundHtml, { encoding: "utf8" });

console.log("fetch translations");
await Promise.all(
	translates.map(async (translate) => {
		const html = await (await fetch(translate.src)).text();
		const dom = new JSDOM(html, { contentType: "text/html" });

		const document = dom.window.document;
		const refs = [...document.querySelectorAll("#mw-content-text .reference")];
		for (const ref of refs) ref.remove();

		const zhs = [...document.querySelectorAll('#mw-content-text .tt-table td[lang="zh"]')];
		const jas = [...document.querySelectorAll('#mw-content-text .tt-table td[lang="ja"]')];

		await fs.writeFile(path.join(SITE_ROOT, translate.ja), jas.map((ja) => ja.textContent).join("\n"), { encoding: "utf-8" });
		await fs.writeFile(path.join(SITE_ROOT, translate.zh), zhs.map((zh) => zh.textContent).join("\n"), { encoding: "utf-8" });
	})
);

console.log("fetch downloads");
for (const chunk of chunks(downloads, 5)) {
	await Promise.all(chunk.map(async ({ source, target }) => await fs.writeFile(path.join(SITE_ROOT, target), await download(source))));
}

console.log("extract manuals");
for (const name of await fs.readdir(MANUALZIP_ROOT, { encoding: "utf-8" })) {
	if (name.endsWith(".zip")) {
		await extract(path.join(MANUALZIP_ROOT, name), { dir: path.resolve(path.join(SITE_ROOT, MANUAL_ROOT)) });
	}
}
