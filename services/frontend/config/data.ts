export type SiteTempData = typeof siteTempData;

export const siteTempData = {
  artikel: [
    {
      artikelnummer: "123456",
      name: "Schraube 1",
      lagernd: 150,
      min_bedarf: 100,
      is_ordered: false,
    },
    {
      artikelnummer: "123457",
      name: "Schraube 2",
      lagernd: 300,
      min_bedarf: 200,
      is_ordered: false,
    },
    {
      artikelnummer: "123458",
      name: "Schraube 3",
      lagernd: 75,
      min_bedarf: 150,
      is_ordered: true,
    },
    {
      artikelnummer: "123459",
      name: "Schraube 4",
      lagernd: 0,
      min_bedarf: 100,
      is_ordered: true,
    },
    {
      artikelnummer: "1234510",
      name: "Schraube 5",
      lagernd: 500,
      min_bedarf: 200,
      is_ordered: false,
    },
    {
      artikelnummer: "1234511",
      name: "Schraube 6",
      lagernd: 100,
      min_bedarf: 150,
      is_ordered: true,
    },
    {
      artikelnummer: "1234512",
      name: "Schraube 7",
      lagernd: 200,
      min_bedarf: 150,
      is_ordered: false,
    },
    {
      artikelnummer: "1234513",
      name: "Schraube 8",
      lagernd: 0,
      min_bedarf: 100,
      is_ordered: false,
    },
    {
      artikelnummer: "1234514",
      name: "Schraube 9",
      lagernd: 0,
      min_bedarf: 100,
      is_ordered: true,
    },
    {
      artikelnummer: "1234515",
      name: "Schraube 10",
      lagernd: 0,
      min_bedarf: 100,
      is_ordered: false,
    },
  ],
  kostenstellen: [
    {
      nummer: "1234",
      bezeichnung: "Kunde 1",
    },
    {
      nummer: "1235",
      bezeichnung: "Lager",
    },
    {
      nummer: "1236",
      bezeichnung: "Intern",
    },
    {
      nummer: "1237",
      bezeichnung: "Kunde 2",
    },
    {
      nummer: "1238",
      bezeichnung: "Kunde 3",
    },
  ],
};
