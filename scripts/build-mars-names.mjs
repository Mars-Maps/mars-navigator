#!/usr/bin/env node
/**
 * Builds the committed Mars place names for Search & Go To.
 *
 * Source: the USGS Gazetteer of Planetary Nomenclature, Mars centre points,
 * the shapefile at ZIP_URL. This script reads its attribute table (the
 * .dbf, UTF-8 per its .cpg) after you unzip it, keeps the names the IAU
 * has adopted, and writes each one's name, feature type, centre
 * (planetocentric, +East 0–360, as the .prj and the Gazetteer state),
 * diameter and Gazetteer feature id. Nothing is rounded beyond 4 decimals
 * of a degree (about 6 m) and 2 of a kilometre.
 *
 * Run:  node scripts/build-mars-names.mjs <MARS_nomenclature_center_pts.dbf> [--retrieved YYYY-MM-DD]
 * Out:  src/data/places/marsNames.json, read only by PlaceNamesAdapter
 */
import { readFileSync, writeFileSync } from 'node:fs'

const ZIP_URL = 'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MARS_nomenclature_center_pts.zip'
const OUT = 'src/data/places/marsNames.json'

const [path, ...rest] = process.argv.slice(2)
if (!path) fail('give the path of MARS_nomenclature_center_pts.dbf')
const retrievedAt = rest[0] === '--retrieved' ? rest[1] : new Date().toISOString().slice(0, 10)
if (!/^\d{4}-\d{2}-\d{2}$/.test(retrievedAt ?? '')) fail('--retrieved must be YYYY-MM-DD')

const records = readDbf(readFileSync(path))
const rows = []
for (const r of records) {
  if (r.approval !== 'Adopted by IAU') continue
  const lat = Number(r.center_lat)
  const lon = Number(r.center_lon)
  const diameter = Number(r.diameter)
  const id = Number(/\/Feature\/(\d+)$/.exec(r.link)?.[1])
  if (!r.name || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isInteger(id)) {
    fail(`unreadable record: ${JSON.stringify(r)}`)
  }
  rows.push([
    r.name,
    // "Crater, craters" → "Crater": the singular, as the Gazetteer lists it first.
    r.type.split(',')[0].trim(),
    round(lat, 4),
    round(lon, 4),
    Number.isFinite(diameter) && diameter > 0 ? round(diameter, 2) : null,
    id,
  ])
}
rows.sort((a, b) => a[0].localeCompare(b[0], 'en'))
// The attribute table repeats a record now and then (Bohar, 16054, twice in
// the 2026 file): an exact repeat is written once. Two different rows
// for one feature id are left in, for PlaceNamesAdapter to refuse.
const unique = []
const written = new Set()
for (const row of rows) {
  const text = JSON.stringify(row)
  if (written.has(text)) continue
  written.add(text)
  unique.push(row)
}

const out = {
  source: `USGS Gazetteer of Planetary Nomenclature, Mars centre points (${ZIP_URL}), names adopted by the IAU; planetocentric, +East 0–360`,
  retrieved: retrievedAt,
  columns: ['name', 'type', 'latitude', 'longitudeEast', 'diameterKm', 'featureId'],
  rows: unique,
}
writeFileSync(OUT, `${JSON.stringify(out)}\n`)
console.log(`${OUT}: ${unique.length} names of ${records.length} records`)

/** A dBASE III table: header, field descriptors, fixed-width records. */
function readDbf(buf) {
  const count = buf.readUInt32LE(4)
  const headerLength = buf.readUInt16LE(8)
  const recordLength = buf.readUInt16LE(10)
  const fields = []
  for (let o = 32; buf[o] !== 0x0d; o += 32) {
    fields.push({ name: buf.toString('latin1', o, o + 11).replace(/\0.*$/, ''), length: buf[o + 16] })
  }
  const out = []
  for (let i = 0; i < count; i++) {
    let p = headerLength + i * recordLength
    if (buf[p] === 0x2a) continue // deleted
    p += 1
    const record = {}
    for (const f of fields) {
      record[f.name] = buf.toString('utf8', p, p + f.length).trim()
      p += f.length
    }
    out.push(record)
  }
  return out
}

function round(x, places) {
  const k = 10 ** places
  return Math.round(x * k) / k
}

function fail(message) {
  console.error(`build-mars-names: ${message}`)
  process.exit(1)
}
