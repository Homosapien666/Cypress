/// <reference types="cypress" />

function moneyToCents(text) {
  const match = String(text).match(/\$\s*([\d,]+)\.(\d{2})(?!\d)/);
  expect(match, `รูปแบบราคา: ${text}`).not.to.be.null;
  const dollars = Number(match[1].replaceAll(',', ''));
  return dollars * 100 + Number(match[2]);
}

function readProducts($rows) {
  return $rows.toArray().map((row) => {
    const $row = Cypress.$(row);
    return {
      name: $row.find('.inventory_item_name').text().trim(),
      priceCents: moneyToCents($row.find('.inventory_item_price').text())
    };
  });
}

function verifySelectedProducts(expectedProducts) {
  return cy.get('.cart_item').should(($rows) => {
    expect($rows, 'จำนวนสินค้าในหน้า').to.have.length(2);
    const actual = readProducts($rows);
    const byName = (a, b) => a.name.localeCompare(b.name);
    expect([...actual].sort(byName), 'ชื่อและราคาต้องตรงกับสินค้าที่เลือก')
      .to.deep.equal([...expectedProducts].sort(byName));

    $rows.toArray().forEach((row) => {
      expect(Cypress.$(row).find('.cart_quantity').text().trim(), 'จำนวนต่อสินค้า')
        .to.equal('1');
    });
  }).then(($rows) => {
    return readProducts($rows).reduce((sum, product) => sum + product.priceCents, 0);
  });
}

describe('SauceDemo: เรียงราคา เลือกสินค้า และชำระเงิน', () => {
  it('ซื้อสินค้าที่แพงที่สุดและถูกที่สุด พร้อมตรวจภาษี 8% และยอดรวม', () => {
    // 1. Login
    cy.visit('/');
    cy.get('[data-test="username"]').type('standard_user');
    cy.get('[data-test="password"]').type('secret_sauce', { log: false });
    cy.get('[data-test="login-button"]').click();
    cy.location('pathname').should('equal', '/inventory.html');

    // 2. Sorting: 
    cy.get('[data-test="product-sort-container"]').select('hilo');
    cy.get('[data-test="product-sort-container"]').should('have.value', 'hilo');

    cy.get('.inventory_item').should(($rows) => {
      const products = readProducts($rows);
      expect(products.length, 'ต้องมีสินค้าอย่างน้อย 2 รายการ').to.be.at.least(2);

      for (let index = 0; index < products.length - 1; index += 1) {
        expect(
          products[index].priceCents,
          `ราคาลำดับ ${index + 1} ต้องไม่น้อยกว่าลำดับ ${index + 2}`
        ).to.be.at.least(products[index + 1].priceCents);
      }
    }).then(($rows) => {
      const products = readProducts($rows);
      // เก็บค่าจริงจากเว็บ ไม่กำหนดชื่อหรือราคาสินค้าไว้ล่วงหน้า
      const selectedProducts = [products[0], products[products.length - 1]];
      cy.wrap(selectedProducts, { log: false }).as('selectedProducts', { type: 'static' });
    });

    // 3. เพิ่มสินค้าราคาแพงที่สุดและถูกที่สุด โดย query DOM ใหม่หลังแต่ละ click
    cy.get('.inventory_item').first().contains('button', /^Add to cart$/).click();
    cy.get('.inventory_item').first().find('button').should('have.text', 'Remove');
    cy.get('.inventory_item').last().contains('button', /^Add to cart$/).click();
    cy.get('.inventory_item').last().find('button').should('have.text', 'Remove');
    cy.get('.shopping_cart_badge').should('have.text', '2');

    // 4. Cart: ต้องมีสินค้าตรงกับที่เลือก 2 รายการ
    cy.get('.shopping_cart_link').click();
    cy.location('pathname').should('equal', '/cart.html');
    cy.get('@selectedProducts').then((expectedProducts) => {
      return verifySelectedProducts(expectedProducts);
    });

    // 5. กรอกข้อมูล 
    cy.get('[data-test="checkout"]').click();
    cy.location('pathname').should('equal', '/checkout-step-one.html');
    cy.get('[data-test="firstName"]').type('Somchai');
    cy.get('[data-test="lastName"]').type('Testing');
    cy.get('[data-test="postalCode"]').type('10110');
    cy.get('[data-test="continue"]').click();
    cy.location('pathname').should('equal', '/checkout-step-two.html');

    // 6. Overview: อ่านราคาสินค้าในหน้านี้มารวมใหม่ และตรวจสินค้าอีกครั้ง
    cy.get('@selectedProducts').then((expectedProducts) => {
      return verifySelectedProducts(expectedProducts);
    }).as('overviewItemTotalCents', { type: 'static' });

    cy.get('@overviewItemTotalCents').then((itemSumCents) => {
      const expectedTaxCents = Math.round((itemSumCents * 8) / 100);
      const expectedTotalCents = itemSumCents + expectedTaxCents;

      cy.get('.summary_info').should(($summary) => {
        const itemTotalCents = moneyToCents($summary.find('.summary_subtotal_label').text());
        const taxCents = moneyToCents($summary.find('.summary_tax_label').text());
        const totalCents = moneyToCents($summary.find('.summary_total_label').text());

        expect(itemTotalCents, 'Item Total = ผลรวมราคาสินค้าใน Overview')
          .to.equal(itemSumCents);
        expect(taxCents, 'Tax = Item Total × 8% ปัดเป็นทศนิยม 2 ตำแหน่ง')
          .to.equal(expectedTaxCents);
        expect(totalCents, 'Total = ผลรวมสินค้า + ภาษีที่คำนวณได้')
          .to.equal(expectedTotalCents);
        expect(totalCents, 'Total = Item Total + Tax ที่หน้าเว็บแสดง')
          .to.equal(itemTotalCents + taxCents);
      });

      cy.log(`Item Total: $${(itemSumCents / 100).toFixed(2)}`);
      cy.log(`Tax 8%: $${(expectedTaxCents / 100).toFixed(2)}`);
      cy.log(`Total: $${(expectedTotalCents / 100).toFixed(2)}`);
    });

    // 7. ตรวจ URL 
    cy.get('[data-test="finish"]').click();
    cy.url().should('equal', 'https://www.saucedemo.com/checkout-complete.html');
    cy.get('[data-test="complete-header"]')
      .should('be.visible')
      .and('have.text', 'Thank you for your order!');
  });
});
