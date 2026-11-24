import { databasePool } from "./db.js";

type Country = {
  code: string;
  name: string;
  nameTh: string;
  flag: string;
  currencyCode: string;
  drivingSide: "LEFT" | "RIGHT";
};

type Location = {
  id: string;
  name: string;
  nameTh: string;
  city: string;
  cityTh: string;
  countryCode: string;
  timeZone: string;
  airportCode: string | null;
};

const locationColumns = `
  l.id, l.name, l."nameTh", l.city, l."cityTh", l."countryCode",
  l."timeZone", l."airportCode"
`;

export async function readCountries(code: string | null = null) {
  const { rows } = await databasePool().query<Country & { locations: Location[] }>(
    `SELECT c.code, c.name, c."nameTh", c.flag, c."currencyCode", c."drivingSide",
       COALESCE((
         SELECT json_agg(location ORDER BY location.name)
         FROM (
           SELECT ${locationColumns}
           FROM locations AS l
           WHERE l."countryCode" = c.code
         ) AS location
       ), '[]'::json) AS locations
     FROM countries AS c
     WHERE ($1::bpchar IS NULL OR c.code = $1)`,
    [code],
  );
  return rows;
}

type LocationFilters = {
  countryCode?: string;
  city?: string;
  id?: string;
};

export async function readLocations({ countryCode, city, id }: LocationFilters) {
  const { rows } = await databasePool().query<Location & { country: Country }>(
    `SELECT ${locationColumns}, json_build_object(
       'code', c.code, 'name', c.name, 'nameTh', c."nameTh", 'flag', c.flag,
       'currencyCode', c."currencyCode", 'drivingSide', c."drivingSide"
     ) AS country
     FROM locations AS l
     JOIN countries AS c ON c.code = l."countryCode"
     WHERE ($1::bpchar IS NULL OR l."countryCode" = $1)
       AND ($2::text IS NULL OR l.city ILIKE $2 OR l."cityTh" LIKE $2)
       AND ($3::text IS NULL OR l.id = $3)
     ORDER BY l."countryCode", l.city, l.name`,
    [countryCode ?? null, city === undefined ? null : `%${city}%`, id ?? null],
  );
  return rows;
}
