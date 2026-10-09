import { mount, RouterLinkStub } from "@vue/test-utils";

import App from "../../App.vue";

describe("App shell", () => {
  function mountApp() {
    return mount(App, {
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
          RouterView: { template: '<div data-test="router-view" />' },
        },
      },
    });
  }

  it("starts collapsed", () => {
    const wrapper = mountApp();

    expect(wrapper.text()).not.toContain("Dashboard");
    expect(wrapper.find('img[alt="Expand"]').exists()).toBe(true);
  });

  it("expands and reveals navigation labels when toggled", async () => {
    const wrapper = mountApp();

    await wrapper.get("button").trigger("click");

    expect(wrapper.text()).toContain("Dashboard");
    expect(wrapper.text()).toContain("Help & Information");
    expect(wrapper.find('img[alt="Collapse"]').exists()).toBe(true);
  });
});
